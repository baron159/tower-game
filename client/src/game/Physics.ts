// Rapier3D physics — drives the wobbly tower simulation.
//
// The Rapier WASM module is initialised once on first call. After that we
// hand back a thin facade exposing only what GameLoop needs: stepping the
// world, syncing Three.js meshes, spawning blocks, picking them up and
// placing them.

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { BlockDef, BlockSnapshot } from "../../../shared/protocol";

export interface PhysicsHandles {
  world: RAPIER.World;
  bodies: RAPIER.RigidBody[];        // index = blockId
  groundBody: RAPIER.RigidBody;
  standBody: RAPIER.RigidBody;       // wobbly platter
  step(): void;
  syncMeshes(meshes: THREE.Mesh[]): void;
  pickUp(blockId: number): void;     // make kinematic for player control
  releaseAt(blockId: number, pos: THREE.Vector3, quat: THREE.Quaternion): void;
  applySnapshot(snap: BlockSnapshot[]): void;
  snapshot(): BlockSnapshot[];
  blockHasFallen(blockId: number): boolean;
  anyBlockFloorContact(): boolean;
  // Highest dynamic-block top surface — used to compute the hover plane so
  // a held block sits just above the current tower instead of metres in the
  // air.
  topSurfaceY(): number;
}

// Deterministic supply-grid layout. Each block gets its own cell well clear
// of any other body or static collider so kinematic siblings never overlap.
export function parkedGridPos(id: number): { x: number; y: number; z: number } {
  const col = id % 8;
  const row = Math.floor(id / 8);
  return { x: (col - 3.5) * 1.4, y: -3, z: (row - 1.5) * 1.4 };
}

let initPromise: Promise<void> | null = null;
export function ensureRapier(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export async function createPhysics(blockDefs: BlockDef[]): Promise<PhysicsHandles> {
  await ensureRapier();

  // Gravity tuned to feel weighty without being too punishing on placement.
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;

  // Static ground (the table). Slightly above y=0 so block fall = floor touch.
  const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0);
  const groundBody = world.createRigidBody(groundDesc);
  const groundCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.05, 20)
      .setRestitution(0.0)
      .setFriction(0.9),
    groundBody,
  );

  // Tower stand. To make the tower wobbly we anchor a kinematic spring-like
  // body that the base block rests on. Rapier doesn't have ball joints out
  // of the box in the JS compat build, so we simulate the wobble by giving
  // the stand a slight curvature (we approximate the rounded base by raising
  // the friction and using a small kinematic body that the base touches).
  const standDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.24, 0);
  const standBody = world.createRigidBody(standDesc);
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(0.03, 0.85)
      .setFriction(0.6)
      .setRestitution(0.0),
    standBody,
  );

  // One body per block. Unplaced blocks are KINEMATIC and parked on a wide
  // grid below the table — if we instead spawned them all dynamic at the
  // same (0,-2,0) point, Rapier's first-step penetration correction would
  // explode them apart and some would tunnel up into the play area,
  // tripping the collapse detector before the player ever did anything.
  // Switching to dynamic happens lazily inside releaseAt() / applySnapshot().
  const bodies: RAPIER.RigidBody[] = [];
  for (const def of blockDefs) {
    const grid = parkedGridPos(def.id);
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(grid.x, grid.y, grid.z)
      .setCanSleep(true)
      .setLinearDamping(0.25)
      .setAngularDamping(0.6);
    const body = world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(def.hx, def.hy, def.hz)
      .setFriction(0.85)
      .setRestitution(0.02)
      .setDensity(1.4);
    world.createCollider(col, body);
    bodies.push(body);
  }

  function step() { world.step(); }

  function syncMeshes(meshes: THREE.Mesh[]) {
    for (let i = 0; i < meshes.length; i++) {
      const b = bodies[i];
      const t = b.translation();
      const r = b.rotation();
      meshes[i].position.set(t.x, t.y, t.z);
      meshes[i].quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  function pickUp(blockId: number) {
    const b = bodies[blockId];
    // Ensure kinematic so the player drives its position. A placed block
    // was dynamic; a parked block was already kinematic.
    if (b.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
      b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
    // Make every collider on this body a sensor while it's held — otherwise
    // sweeping the kinematic block through the tower area to position it
    // would push the dynamic tower blocks aside and topple them. Sensors
    // generate intersection events but no contact forces.
    for (let i = 0; i < b.numColliders(); i++) {
      b.collider(i).setSensor(true);
    }
  }

  function releaseAt(blockId: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const b = bodies[blockId];
    // Re-solidify before going dynamic, otherwise the drop would be a no-op
    // physically (sensors don't collide).
    for (let i = 0; i < b.numColliders(); i++) {
      b.collider(i).setSensor(false);
    }
    b.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    b.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
    if (b.bodyType() !== RAPIER.RigidBodyType.Dynamic) {
      b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    }
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.wakeUp();
  }

  function applySnapshot(snap: BlockSnapshot[]) {
    for (const s of snap) {
      const b = bodies[s.id];
      if (!b) continue;
      // Always restore solid colliders — pickUp() may have left this body
      // sensored. Cancel / rematch paths rely on applySnapshot to reset.
      for (let i = 0; i < b.numColliders(); i++) {
        b.collider(i).setSensor(false);
      }
      if (s.placed) {
        // On the tower — dynamic so it can wobble and fall.
        if (b.bodyType() !== RAPIER.RigidBodyType.Dynamic) {
          b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        }
        b.setTranslation({ x: s.x, y: s.y, z: s.z }, false);
        b.setRotation({ x: s.qx, y: s.qy, z: s.qz, w: s.qw }, false);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
        b.wakeUp();
      } else {
        // Parked supply — kinematic at the deterministic grid cell. We
        // ignore the snapshot position (the server uses y=-2 sentinel) and
        // route to our own grid so siblings never collide.
        if (b.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
          b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        }
        const g = parkedGridPos(s.id);
        b.setTranslation(g, false);
        b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
      }
    }
  }

  function snapshot(): BlockSnapshot[] {
    const out: BlockSnapshot[] = [];
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      const t = b.translation();
      const r = b.rotation();
      out.push({
        id: i,
        x: t.x, y: t.y, z: t.z,
        qx: r.x, qy: r.y, qz: r.z, qw: r.w,
        placed: t.y > -1, // anything not parked is "in play"
      });
    }
    return out;
  }

  function blockHasFallen(blockId: number): boolean {
    const b = bodies[blockId];
    const t = b.translation();
    return t.y < 0.05;
  }

  function anyBlockFloorContact(): boolean {
    // Use Rapier's narrow-phase contact info rather than a y-threshold —
    // the threshold approach mis-fires on the brief penetration-correction
    // overshoot that happens when a block first touches a static collider.
    // A dynamic block touching the ground collider = it fell off the tower.
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.isDynamic()) continue;
      if (b.numColliders() === 0) continue;
      const blockCollider = b.collider(0);
      let touching = false;
      world.contactPair(groundCollider, blockCollider, (manifold, _flipped) => {
        if (manifold.numContacts() > 0) touching = true;
      });
      if (touching) return true;
    }
    return false;
  }

  function topSurfaceY(): number {
    // Start at the stand top so the very first block has a real target.
    let max = 0.27;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.isDynamic()) continue; // skip parked + held
      const t = b.translation();
      if (t.y < -0.5) continue;
      const def = blockDefs[i];
      const top = t.y + def.hy;
      if (top > max) max = top;
    }
    return max;
  }

  return {
    world, bodies, groundBody, standBody,
    step, syncMeshes, pickUp, releaseAt, applySnapshot, snapshot,
    blockHasFallen, anyBlockFloorContact, topSurfaceY,
  };
}
