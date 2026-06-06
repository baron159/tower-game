// App entrypoint. Shows the menu, opens a Cloudflare-backed room, then hands
// control to the game loop.

import { showMenu } from "./ui/Menu";
import { connect, createRoom } from "./net/Client";
import { startGameLoop } from "./game/GameLoop";
import type { PlayerInfo, RoomState } from "../../shared/protocol";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;

async function boot() {
  const choice = await showMenu(uiRoot);

  let roomCode = choice.roomCode!;
  if (choice.mode === "host") {
    try {
      roomCode = await createRoom();
    } catch (e) {
      uiRoot.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:14px system-ui;background:#08130e;text-align:center;padding:24px;">
        <div>
          <h2 style="color:#fbb;margin:0 0 8px;">Couldn't reach the server</h2>
          <p style="color:#9fe1cb;margin:0 0 16px;">${(e as Error).message}</p>
          <p style="color:#6b8c80;font-size:12px;">Did you start the Cloudflare Worker? <code>npm run dev:server</code></p>
        </div>
      </div>`;
      return;
    }
  }

  // Open the room socket. The server replies with "welcome" once it has
  // assigned us a player id and seeded our view of the room.
  const net = connect(roomCode, choice.name);

  const ready = new Promise<{ me: PlayerInfo; state: RoomState }>((resolve) => {
    net.on("welcome", (msg) => resolve({ me: msg.you, state: msg.state }));
  });

  const splash = document.createElement("div");
  splash.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9fe1cb;font:14px system-ui;background:#08130e;z-index:5;`;
  splash.textContent = `Joining room ${roomCode}…`;
  uiRoot.appendChild(splash);

  const { me, state } = await ready;
  splash.remove();
  await startGameLoop({ canvas, uiRoot, net, initialState: state, me });
}

boot().catch((e) => {
  console.error(e);
  uiRoot.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:14px system-ui;background:#08130e;text-align:center;padding:24px;">
    <div>
      <h2 style="color:#fbb;margin:0 0 8px;">Couldn't start the game</h2>
      <p style="color:#9fe1cb;margin:0 0 16px;">${(e as Error).message}</p>
    </div>
  </div>`;
});
