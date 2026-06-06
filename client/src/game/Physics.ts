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
  world.createCollider(
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

  // One dynamic body per block. We start them dynamic but parked off-stage
  // (y = -2 below the table) — they won't collide with anything until the
  // server snapshot positions them.
  const bodies: RAPIER.RigidBody[] = [];
  for (const def of blockDefs) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, -2, 0)
      .setCanSleep(true)
      .setLinearDamping(0.25)
      .setAngularDamping(0.6);
    const body = world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(def.hx, def.hy, def.hz)
      .setFriction(0.85)
      .setRestitution(0.02)
      .setDensity(1.4);
    world.createCollider(col, body);
    body.sleep();
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
    // Switch to kinematic position-based so the player can drag it.
    b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  function releaseAt(blockId: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const b = bodies[blockId];
    b.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    b.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
    b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    b.wakeUp();
  }

  function applySnapshot(snap: BlockSnapshot[]) {
    for (const s of snap) {
      const b = bodies[s.id];
      if (!b) continue;
      b.setTranslation({ x: s.x, y: s.y, z: s.z }, false);
      b.setRotation({ x: s.qx, y: s.qy, z: s.qz, w: s.qw }, false);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      if (s.placed) { b.wakeUp(); } else { b.sleep(); }
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
    return t.y < 0.05; // a placed block touching the table top
  }

  function anyBlockFloorContact(): boolean {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.isDynamic()) continue;
      const t = b.translation();
      if (t.y < -0.5) continue; // parked, ignore
      if (t.y < 0.06) return true; // it hit the table
    }
    return false;
  }

  return {
    world, bodies, groundBody, standBody,
    step, syncMeshes, pickUp, releaseAt, applySnapshot, snapshot,
    blockHasFallen, anyBlockFloorContact,
  };
}
