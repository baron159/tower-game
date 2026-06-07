// Central per-frame loop. Owns the integration between renderer, physics,
// input, HUD, and the network client.

import * as THREE from "three";
import type { Card, PlayerInfo, RoomState, BlockSnapshot } from "../../../shared/protocol";
import type { NetClient } from "../net/Client";
import { createRenderer, type RenderHandles } from "./Renderer";
import { createPhysics, type PhysicsHandles } from "./Physics";
import { createInput, type InputHandles } from "./Input";
import { HUD } from "../ui/HUD";
import { sfx, primeAudio } from "../assets/Audio";

interface HeldBlock {
  blockId: number;
  yaw: number;        // rotation around Y for placement
  hoverHeight: number; // current Y target for the held block
}

const TICK_HZ = 12; // network tick rate while manipulating

export async function startGameLoop(opts: {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  net: NetClient;
  initialState: RoomState;
  me: PlayerInfo;
}) {
  const { canvas, uiRoot, net, initialState, me } = opts;

  const render = createRenderer(canvas);
  const physics = await createPhysics(render.blockDefs);

  let state: RoomState = initialState;
  let held: HeldBlock | null = null;
  let lastTickSent = 0;
  let collapseReported = false;
  let stableFrames = 0;

  const hud = new HUD(uiRoot, {
    onStart: () => net.send({ t: "startGame" }),
    onDraw:  () => {
      primeAudio();
      net.send({ t: "drawCard" });
      sfx.cardDraw();
    },
    onConfirm: () => attemptConfirm(),
    onCancel:  () => cancelHold(),
    onRematch: () => net.send({ t: "rematch" }),
    onChat:    (text) => net.send({ t: "chat", text }),
    onCopyCode: () => {
      navigator.clipboard?.writeText(state.roomCode).then(
        () => hud.toast(`Copied ${state.roomCode}`),
        () => hud.toast("Copy failed — code: " + state.roomCode),
      );
    },
  });
  hud.setMe(me);
  hud.showRoomCode(state.roomCode);
  hud.showState(state, !!held);

  // Apply initial server snapshot to physics so blocks start at the right spots.
  physics.applySnapshot(state.blocks);

  // ---- Networking ----
  net.on("state", (msg) => {
    const prevPhase = state.phase;
    state = msg.state;
    // Apply the server's canonical block layout unless I'm in the middle of
    // resolving a build/move card. Earlier we only skipped this on "my turn"
    // unconditionally, which meant the active player never received the
    // initial base-block placement and was running with an empty tower.
    const iAmHoldingOrSettling =
      state.currentTurnPlayerId === me.id &&
      !!state.activeCard &&
      (state.activeCard.kind === "build" || state.activeCard.kind === "move");
    if (!iAmHoldingOrSettling) {
      physics.applySnapshot(state.blocks);
    }
    if (state.phase === "playing" && state.currentTurnPlayerId === me.id && !state.activeCard) {
      // Just became my turn (no card drawn yet).
      if (prevPhase !== "playing" || state.activeCard !== null) {
        // ignore
      }
      sfx.yourTurn();
    }
    if (state.phase === "playing" && state.currentTurnPlayerId === me.id && state.activeCard) {
      handleNewActiveCard(state.activeCard);
    }
    if (state.phase === "collapsed" || state.phase === "finished") {
      if (prevPhase === "playing") {
        if (state.loserId === me.id) sfx.lose();
        else sfx.collapse();
      }
      if (state.phase === "finished") {
        if (state.loserId !== me.id) sfx.win();
        hud.showEndScreen(state);
      }
    } else {
      hud.hideEndScreen();
    }
    if (state.phase === "lobby") {
      hud.hideEndScreen();
      collapseReported = false;
      held = null;
    }
    hud.showState(state, !!held);
  });

  net.on("tick", (msg) => {
    // Forwarded block positions from the active player. Apply only if I am
    // not the active player (their own physics is canonical for them).
    if (msg.fromPlayerId !== me.id) {
      physics.applySnapshot(msg.blocks);
    }
  });

  net.on("error", (msg) => {
    hud.toast(msg.message);
  });

  // ---- Input ----
  const input = createInput({
    pickRequested: (blockId) => {
      // Any click while holding = drop, regardless of what was intersected.
      if (held) { dropHeld(); return; }
      if (!isMyTurn() || !state.activeCard) return;
      if (!canPick(blockId, state.activeCard)) return;
      pickUp(blockId);
    },
    dropRequested: () => {
      if (held) dropHeld();
    },
    rotateBlock: (delta) => {
      if (held) held.yaw += delta;
    },
  });
  input.installListeners(canvas);

  // ---- Main loop ----
  const clock = new THREE.Clock();
  let acc = 0;
  const fixedDt = 1 / 60;

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.1);
    acc += dt;
    while (acc >= fixedDt) {
      physics.step();
      acc -= fixedDt;
    }
    input.updateCamera(render.camera);

    // Held block tracking
    if (held) {
      const target = new THREE.Vector3();
      const ok = input.pointerOnHeightPlane(render.camera, held.hoverHeight, target);
      if (ok) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, held.yaw, 0));
        physics.bodies[held.blockId].setNextKinematicTranslation({ x: target.x, y: target.y, z: target.z });
        physics.bodies[held.blockId].setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        render.highlight.position.set(target.x, 0.26, target.z);
        render.highlight.visible = true;
      }
    } else {
      // Hover highlight on top of pickable target.
      const hit = input.intersectMeshes(render.camera, render.blockMeshes);
      if (hit && isMyTurn() && state.activeCard && canPick((hit.mesh.userData.blockId as number), state.activeCard)) {
        render.highlight.position.set(hit.point.x, 0.26, hit.point.z);
        render.highlight.visible = true;
      } else {
        render.highlight.visible = false;
      }
    }

    physics.syncMeshes(render.blockMeshes);

    // Stability detection (when active player has dropped a block).
    if (state.phase === "playing" && state.currentTurnPlayerId === me.id && !held && state.activeCard) {
      if (allBlocksStable()) stableFrames++;
      else stableFrames = 0;
    }

    // Collapse detection — only the active player reports it. We require
    // the player to have actually started a turn (drawn at least one card)
    // before any collapse can be attributed to them; otherwise an early
    // physics hiccup right after game-start could end the round.
    const hasManipulated = !!state.activeCard || stableFrames > 0;
    if (state.phase === "playing" && state.currentTurnPlayerId === me.id && !collapseReported && hasManipulated) {
      if (physics.anyBlockFloorContact()) {
        collapseReported = true;
        net.send({ t: "reportCollapse", blocks: physics.snapshot() });
        sfx.collapse();
      }
    }

    // Throttled tick broadcast so spectators see the wobble.
    if (state.phase === "playing" && state.currentTurnPlayerId === me.id) {
      const now = performance.now();
      if (now - lastTickSent > 1000 / TICK_HZ) {
        lastTickSent = now;
        net.send({ t: "blockTick", blocks: physics.snapshot() });
      }
    }

    render.renderer.render(render.scene, render.camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- Helpers ----
  function isMyTurn(): boolean {
    return state.phase === "playing" && state.currentTurnPlayerId === me.id;
  }

  function handleNewActiveCard(card: Card) {
    if (card.kind === "build") {
      // Auto-pick up the matching block so the player can place it.
      const blockId = card.blockIndex;
      const snap = state.blocks[blockId];
      if (snap && !snap.placed) {
        pickUp(blockId);
      } else {
        hud.toast("Block already on tower — that shouldn't happen!");
      }
    } else if (card.kind === "move") {
      hud.toast("Click any block on the tower to move it.");
    }
  }

  function canPick(blockId: number, card: Card): boolean {
    if (card.kind === "build") return blockId === card.blockIndex;
    if (card.kind === "move") return state.blocks[blockId]?.placed ?? false;
    return false;
  }

  function pickUp(blockId: number) {
    primeAudio();
    sfx.blockPickup();
    held = {
      blockId,
      yaw: 0,
      hoverHeight: estimateTopHeight() + 0.6,
    };
    physics.pickUp(blockId);
  }

  function dropHeld() {
    if (!held) return;
    primeAudio();
    const target = new THREE.Vector3();
    if (!input.pointerOnHeightPlane(render.camera, held.hoverHeight, target)) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, held.yaw, 0));
    physics.releaseAt(held.blockId, target, q);
    sfx.blockPlace();
    render.highlight.visible = false;
    held = null;
    stableFrames = 0;
    hud.showState(state, false);
  }

  function cancelHold() {
    if (!held || !state.activeCard) return;
    // Restore to the pre-pick position from state.
    const snap = state.blocks[held.blockId];
    if (snap) {
      const pos = new THREE.Vector3(snap.x, snap.y, snap.z);
      const q = new THREE.Quaternion(snap.qx, snap.qy, snap.qz, snap.qw);
      physics.releaseAt(held.blockId, pos, q);
    }
    held = null;
    render.highlight.visible = false;
    hud.showState(state, false);
  }

  function attemptConfirm() {
    if (!state.activeCard) return;
    if (held) {
      hud.toast("Drop the block first.");
      return;
    }
    if (stableFrames < 24) {
      hud.toast("Wait for the tower to settle.");
      return;
    }
    if (physics.anyBlockFloorContact()) {
      // Will trigger collapse reporting on its own.
      return;
    }
    net.send({ t: "resolveCard", cardId: state.activeCard.id, blocks: physics.snapshot() });
    stableFrames = 0;
  }

  function estimateTopHeight(): number {
    let max = 0.3;
    for (const s of state.blocks) {
      if (s.placed && s.y > max) max = s.y;
    }
    return max;
  }

  function allBlocksStable(): boolean {
    for (let i = 0; i < physics.bodies.length; i++) {
      const b = physics.bodies[i];
      if (!b.isDynamic()) continue;
      const v = b.linvel();
      const w = b.angvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      const spin = Math.hypot(w.x, w.y, w.z);
      const t = b.translation();
      if (t.y < -0.5) continue; // parked supply
      if (speed > 0.04 || spin > 0.08) return false;
    }
    return true;
  }
}

// Re-export for convenience
export type { RenderHandles, PhysicsHandles, InputHandles };
export type AnyBlockSnapshot = BlockSnapshot; // ensure shared type is used
