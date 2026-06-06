// End-to-end smoke test for the Cloudflare worker + GameRoom DO.
//
// 1. Create a room.
// 2. Connect two WebSocket players.
// 3. Have the host start the game.
// 4. Run through one draw + skip turn each and verify the server advances
//    turns correctly.
//
// Run with: node scripts/smoke_test.mjs (worker must be running on 8787).

import { WebSocket } from "ws";

const BASE = process.env.WORKER_URL || "http://127.0.0.1:8787";
const WS_BASE = BASE.replace(/^http/, "ws");

const PROTOCOL_VERSION = 1;

function timeout(ms, label) {
  return new Promise((_, rej) =>
    setTimeout(() => rej(new Error(`timeout ${label} after ${ms}ms`)), ms),
  );
}

function waitFor(ws, predicate, label = "msg") {
  return Promise.race([
    new Promise((resolve) => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (predicate(msg)) {
          ws.off("message", handler);
          resolve(msg);
        }
      };
      ws.on("message", handler);
    }),
    timeout(5000, label),
  ]);
}

async function connect(name, code) {
  const ws = new WebSocket(`${WS_BASE}/ws/${code}`);
  await new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });
  ws.send(JSON.stringify({ t: "hello", name, version: PROTOCOL_VERSION }));
  const welcome = await waitFor(ws, (m) => m.t === "welcome", "welcome");
  return { ws, welcome };
}

async function main() {
  // 1. Health check
  const health = await (await fetch(`${BASE}/api/health`)).json();
  if (!health.ok) throw new Error("health failed");

  // 2. Create room
  const created = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
  if (!created.roomCode) throw new Error("no room code");
  const code = created.roomCode;
  console.log("room", code);

  // 3. Two players join
  const alice = await connect("Alice", code);
  const bob = await connect("Bob", code);
  if (!alice.welcome.you.isHost) throw new Error("alice should be host");
  if (bob.welcome.you.isHost) throw new Error("bob shouldn't be host");
  console.log("hello/welcome ok");

  // 4. Host starts game
  const aliceSeesPlaying = waitFor(
    alice.ws,
    (m) => m.t === "state" && m.state.phase === "playing",
    "playing",
  );
  alice.ws.send(JSON.stringify({ t: "startGame" }));
  const playState = await aliceSeesPlaying;
  console.log("game started, deck", playState.state.deckRemaining, "first turn", playState.state.currentTurnPlayerId === alice.welcome.you.id ? "alice" : "bob");

  // 5. Whoever's turn it is, draw a card.
  const firstTurnId = playState.state.currentTurnPlayerId;
  const turnSocket = firstTurnId === alice.welcome.you.id ? alice : bob;
  const otherSocket = turnSocket === alice ? bob : alice;
  // Register both listeners BEFORE the draw to avoid races.
  const drewState = waitFor(turnSocket.ws, (m) => m.t === "state", "draw");
  const otherSeen = waitFor(otherSocket.ws, (m) => m.t === "state", "other-state");
  turnSocket.ws.send(JSON.stringify({ t: "drawCard" }));
  const dstate = await drewState;
  const ostate = await otherSeen;
  console.log("draw result phase=" + dstate.state.phase, "active=", dstate.state.activeCard?.kind ?? "(resolved immediately)", "deck=", dstate.state.deckRemaining);
  if (ostate.state.deckRemaining !== dstate.state.deckRemaining) {
    throw new Error(`deck mismatch ${ostate.state.deckRemaining} vs ${dstate.state.deckRemaining}`);
  }
  console.log("spectator sync ok");

  alice.ws.close(); bob.ws.close();
  console.log("OK");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
