# Tower Stack

A 3D card-driven tower-stacking game with real wobbly-tower physics and
online multiplayer. Inspired by Relatable's *Tower Stack* (2024).

- **Client**: Three.js + Rapier3D physics (TypeScript, Vite)
- **Server**: Cloudflare Workers + Durable Objects (one DO per room, WebSocket
  Hibernation API) — TypeScript
- **Desktop / Steam / Itch.io build**: Tauri 2
- **Assets**: 100% procedural — block textures painted on a `<canvas>`, sound
  effects synthesised with the Web Audio API. Zero binary asset dependencies.

```
tower-game/
├── client/            Three.js game (Vite)
├── server/            Cloudflare Worker + GameRoom Durable Object
├── shared/            Wire-protocol types shared by both halves
├── src-tauri/         Desktop wrapper for Steam/Itch
└── scripts/           Icon generator + multiplayer smoke test
```

---

## Prerequisites

| Tool   | Version  | Why                                              |
|--------|----------|--------------------------------------------------|
| Node   | ≥ 20     | Vite + TypeScript + Wrangler                     |
| npm    | ≥ 10     | Workspaces                                       |
| Rust   | ≥ 1.77   | Tauri desktop builds *(skip if web-only)*        |
| Python | ≥ 3.9    | One-off icon generator *(prebuilt icons checked in)* |

Tauri's per-OS native toolchain (xcode-select on macOS, MSVC + WebView2 on
Windows, `libwebkit2gtk-4.1-dev` + `libgtk-3-dev` + `librsvg2-dev` on Linux)
is only needed when you actually want to produce a desktop binary. The web
client + Cloudflare server build and run fine without it.

---

## 1) Install

```sh
git clone <repo>
cd tower-game
npm install
```

This installs both the `client/` and `server/` workspaces.

---

## 2) Run locally

Open two terminals (or use `npm run dev` to launch both in parallel):

```sh
# Terminal A — Cloudflare Worker + Durable Object on http://127.0.0.1:8787
npm run dev:server

# Terminal B — Vite dev server on http://127.0.0.1:5173 (proxies /api + /ws)
npm run dev:client
```

Or both together:

```sh
npm run dev
```

Open <http://127.0.0.1:5173> in two browser windows (or two devices on your
LAN — `vite --host` is already enabled). Click **Host game** in one, copy the
room code, paste into the other window's **Join with code** tab. Host clicks
**Start game** once at least 2 players are in the room.

**Controls**

| Action | Input |
|--------|-------|
| Orbit camera | Right-mouse drag (or Shift + drag) |
| Zoom         | Scroll wheel |
| Pick / drop block | Left-click |
| Rotate held block | `Q` / `E` |
| Confirm placement | Click **Confirm placement** |

### Smoke-test the multiplayer flow

With the worker running:

```sh
npm run smoke
```

Spins up two WebSocket clients, runs through a join → start → draw cycle,
asserts that the spectator sees the same deck count as the active player.

---

## 3) Build for production (web only)

```sh
npm run build           # builds client/dist + dry-runs the Worker
```

Outputs:

- `client/dist/`  — static SPA bundle
- The Worker's `wrangler deploy --dry-run` confirms the upload is valid

Deploy the Worker (and the SPA, which it serves from the `[assets]` binding):

```sh
# One-time
npx wrangler login

# Each deploy
npm run build
npm run deploy:server
```

The Worker will serve the client at its root URL and the WebSocket at
`/ws/<roomCode>`, so a single `wrangler deploy` ships both halves.

---

## 4) Build a desktop binary (Steam / Itch.io)

The desktop wrapper is Tauri 2. It embeds the built web client and points the
in-app webview at the local bundle, while the multiplayer client connects out
to your deployed Cloudflare Worker.

```sh
# One-time: install the Tauri CLI globally (or use the workspace dev dep)
npm install -g @tauri-apps/cli@latest

# Tell the client where the production Worker lives.
echo "VITE_SERVER_URL=https://tower-stack.<your-subdomain>.workers.dev" > client/.env.production

npm run tauri:build
```

Outputs live under `src-tauri/target/release/bundle/`:

| Platform | Artifact                                  | Steam-ready? |
|----------|-------------------------------------------|--------------|
| Windows  | `msi/`, `nsis/`                           | Yes — upload the unpacked `.exe` + DLLs as a Steam depot |
| macOS    | `dmg/`, `macos/Tower Stack.app`           | Yes — `.app` bundle is what Steam uploads |
| Linux    | `deb/`, `appimage/`, `rpm/`               | Yes — Itch prefers `.AppImage`; Steam takes the unpacked binary |

Run it locally during development:

```sh
npm run tauri:dev
```

---

## Architecture in one paragraph

The client owns rendering and physics. The Cloudflare Worker's
`GameRoom` Durable Object owns turn order, the deck, and "did the tower
collapse?" — but it does *not* simulate physics. Whichever player's turn it
is runs the simulation locally and pushes block-position snapshots up to the
server at ~12 Hz; the server fans those out verbatim to spectators so they see
the same wobble. When the active player's client detects a block hit the
table, it sends `reportCollapse`; the server marks them as the loser. The DO
uses Cloudflare's WebSocket Hibernation API, so a long-running lobby costs
essentially zero while nobody is touching anything.

## Regenerating the icon set

The icons committed under `src-tauri/icons/` were generated procedurally.
To rebuild:

```sh
npm run icons   # python3 scripts/gen_icons.py
```

## Troubleshooting

- **"Couldn't reach the server" in the menu**: the Worker isn't running.
  Start it with `npm run dev:server` (port 8787). The Vite dev server
  proxies `/api` and `/ws` there.
- **WASM physics fails to load**: Rapier ships its `.wasm` inline in the
  `-compat` bundle. If you see a 404 in dev, hard-reload the page — Vite's
  dep-optimisation cache occasionally goes stale. `rm -rf client/node_modules/.vite`
  then restart.
- **Tauri build fails on Linux** with `webkit2gtk-4.1` missing: install your
  distro's `libwebkit2gtk-4.1-dev` (or `webkit2gtk4.1-devel`).

See [`STEAM_CHECKLIST.md`](./STEAM_CHECKLIST.md) for everything else you need
to complete before you can list the game on Steam.
