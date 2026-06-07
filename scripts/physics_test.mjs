// Headless physics regression test.
//
// Catches the class of bug where the active player's tower physics misfires
// before any block has been placed (i.e. anyBlockFloorContact returns true
// straight after game-start). Run this whenever you touch Physics.ts or the
// server-side initial layout.
//
// Usage: node scripts/physics_test.mjs   (no worker needed)

import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";

// JSDOM gives Rapier the document / requestAnimationFrame / crypto globals
// it touches even from the -compat WASM bundle.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;

const RAPIER = await import("@dimforge/rapier3d-compat");
await RAPIER.init();

// Mirror the server's startup layout.
const buildBlockCatalogue = () => {
  const out = [];
  for (let i = 0; i < 32; i++) {
    const cycle = i % 3;
    const shape = cycle === 0 ? "slab" : cycle === 1 ? "cube" : "wedge";
    const hx = shape === "slab" ? 0.55 : shape === "cube" ? 0.32 : 0.45;
    const hy = shape === "slab" ? 0.13 : shape === "cube" ? 0.32 : 0.18;
    const hz = shape === "slab" ? 0.30 : shape === "cube" ? 0.32 : 0.30;
    out.push({ id: i, shape, hx, hy, hz });
  }
  return out;
};

const blockDefs = buildBlockCatalogue();
const BASE = [0, 3, 6];
const BASE_Y = [0.40, 0.66, 0.92];

function parkedGridPos(id) {
  const col = id % 8;
  const row = Math.floor(id / 8);
  return { x: (col - 3.5) * 1.4, y: -3, z: (row - 1.5) * 1.4 };
}

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 60;

// Ground.
const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0);
const groundBody = world.createRigidBody(groundDesc);
const groundCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.05, 20).setFriction(0.9), groundBody);

// Stand.
const standDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0.24, 0);
const standBody = world.createRigidBody(standDesc);
world.createCollider(RAPIER.ColliderDesc.cylinder(0.03, 0.85).setFriction(0.6), standBody);

// Blocks — kinematic on a grid (matches the fixed Physics.ts).
const bodies = blockDefs.map((def) => {
  const g = parkedGridPos(def.id);
  const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(g.x, g.y, g.z);
  const b = world.createRigidBody(desc);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(def.hx, def.hy, def.hz).setFriction(0.85).setRestitution(0.02).setDensity(1.4),
    b,
  );
  return b;
});

// Apply the server's start-game snapshot: base slabs become dynamic on the stand.
for (let i = 0; i < BASE.length; i++) {
  const id = BASE[i];
  const b = bodies[id];
  b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  b.setTranslation({ x: 0, y: BASE_Y[i], z: 0 }, false);
  b.setLinvel({ x: 0, y: 0, z: 0 }, true);
  b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  b.wakeUp();
}

function anyBlockFloorContact() {
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (!b.isDynamic()) continue;
    if (b.numColliders() === 0) continue;
    const bc = b.collider(0);
    let touching = false;
    world.contactPair(groundCollider, bc, (manifold) => {
      if (manifold.numContacts() > 0) touching = true;
    });
    if (touching) return true;
  }
  return false;
}

// Step the world for 3 seconds (180 frames at 60Hz) and verify no false collapse.
let collapsed = false;
let collapseAtFrame = -1;
for (let frame = 0; frame < 180; frame++) {
  world.step();
  if (anyBlockFloorContact()) {
    collapsed = true;
    collapseAtFrame = frame;
    break;
  }
}

if (collapsed) {
  console.error(`FAIL: false collapse detected at frame ${collapseAtFrame}`);
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (!b.isDynamic()) continue;
    const t = b.translation();
    const v = b.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    console.error(`  block ${i} y=${t.y.toFixed(3)} speed=${speed.toFixed(3)}`);
  }
  process.exit(1);
}

// Verify base blocks have settled approximately on the stand.
for (let i = 0; i < BASE.length; i++) {
  const t = bodies[BASE[i]].translation();
  assert.ok(t.y > 0.27, `base block ${i} sank below stand top, y=${t.y}`);
  assert.ok(t.y < 1.5, `base block ${i} flew off, y=${t.y}`);
}

// Verify a placed-then-dropped block on the table DOES eventually trigger.
const dropId = 4;
const drop = bodies[dropId];
drop.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
drop.setTranslation({ x: 2.5, y: 1.5, z: 2.5 }, false); // off the stand
drop.setLinvel({ x: 0, y: 0, z: 0 }, true);
drop.setAngvel({ x: 0, y: 0, z: 0 }, true);
drop.wakeUp();
let trueCollapse = false;
for (let frame = 0; frame < 180; frame++) {
  world.step();
  if (anyBlockFloorContact()) { trueCollapse = true; break; }
}
assert.ok(trueCollapse, "off-stand drop should eventually be detected as a collapse");

console.log("OK — no false collapse on init, true collapse detected on off-stand drop");
