# Steam & Itch.io listing checklist

The repository as-shipped builds a working multiplayer game with desktop
binaries. Steam (and to a lesser extent Itch.io) need a number of *business
+ creative* artefacts on top of that before you can hit "publish". Use this
file as the punch-list for everything that still needs to happen outside the
codebase.

## What's already done

- [x] **Playable build**: client + server + desktop wrapper compile and pass a
  smoke test (`npm run smoke`).
- [x] **Cross-platform packaging**: Tauri 2 emits Windows (`.exe`/`.msi`),
  macOS (`.app`/`.dmg`), and Linux (`.deb`/`.AppImage`/`.rpm`) artefacts.
- [x] **Multiplayer backend**: Cloudflare Worker + Durable Object with a
  WebSocket Hibernation transport — cheap and globally distributed.
- [x] **MIT licence** and a procedurally-generated icon set.
- [x] **No third-party asset dependencies** — no licence audits required for
  art, audio, or fonts.

---

## Steam — required before you can ship

### Legal & account
- [ ] **Register a Steamworks publisher account**. This is a US-tax-info-and-
  bank-account form; allow a few business days for Steam's review.
- [ ] **Pay Steam Direct fee** — **US $100 per app**, refundable after the app
  reaches US $1,000 in adjusted gross revenue.
- [ ] **Identity verification** (Steam's KYC) — submit gov't ID + tax forms
  (W-9 for US, W-8BEN for non-US).
- [ ] **Bank account / payment payee** set up in the Steamworks dashboard.

### Build & distribution
- [ ] Decide whether to integrate the **Steamworks SDK**. Tower Stack does not
  need it functionally — multiplayer runs through Cloudflare and is platform-
  independent. But you may want it for:
  - Steam achievements / stats
  - Steam Cloud saves (sync your local options + name)
  - Rich Presence (showing "In Lobby" in friends list)
  - Steam friend invites that auto-join a room
  If you add it, wire `steamworks-rs` into `src-tauri/src/lib.rs`'s `setup()`
  hook. There's a placeholder comment marking the spot.
- [ ] Build & upload **depot** with the SteamPipe CLI (`steamcmd +login <publisher> +run_app_build <app_build.vdf>`). Recommended depot layout:
  - `depot/windows/`: Tauri's NSIS install dir contents
  - `depot/macos/`:   the `.app` bundle from Tauri
  - `depot/linux/`:   the unpacked Tauri AppImage / deb contents
- [ ] Set the **launch options** in the Steamworks app:
  - Windows: `tower-stack.exe`
  - macOS:   `Tower Stack.app/Contents/MacOS/tower-stack`
  - Linux:   `tower-stack` (or `.AppImage`)

### Store-page assets (Steam requires *all* of these)
- [ ] **Header capsule**           — 460 × 215 PNG/JPG
- [ ] **Small capsule**            — 231 × 87
- [ ] **Main capsule**             — 616 × 353
- [ ] **Vertical capsule**         — 374 × 448
- [ ] **Page background**          — 1438 × 810
- [ ] **Library hero**             — 3840 × 1240
- [ ] **Library logo (transparent)** — 1280 × 720 PNG
- [ ] **Library capsule**          — 600 × 900
- [ ] **Community icon**           — 184 × 184
- [ ] **At least 5 screenshots**   — 1280 × 720 or higher (16:9 strongly preferred)
- [ ] **One trailer**              — 30s–60s, 1080p, H.264, ≤ 100 MB

If you want to keep the "no external assets" promise, you can generate the
key art by capturing screenshots from the game itself + compositing in your
graphics tool of choice. The icon generator in `scripts/gen_icons.py` is a
working starting point.

### Store-page text
- [ ] **Short description** (≤ 300 chars)
- [ ] **About this game**   — full marketing copy, supports BBCode
- [ ] **Tags** — pick 3–5 from Steam's curated tag list (good fits:
  *Party Game*, *Multiplayer*, *Casual*, *Physics*, *Local Multiplayer* if
  you add same-screen play)
- [ ] **System requirements** — Tower Stack is GPU-modest; suggested min:
  - Win 10 64-bit, dual-core 2 GHz, 4 GB RAM, OpenGL 4.1-capable GPU
  - macOS 10.15+, Apple Silicon or Intel
  - Linux: webkit2gtk-4.1, OpenGL 4.1

### Compliance
- [ ] **Age rating questionnaire** (Steam runs this in-platform — no
  third-party rating fee).
- [ ] **Privacy policy URL** — *required* because the game opens a network
  socket. A one-pager hosted anywhere (GitHub Pages, your own site) is fine.
  Cover: "we collect player name + room code; data is ephemeral; no
  analytics; contact info."
- [ ] **EULA** — Steam ships a default boilerplate you can use as-is, or
  upload your own. The MIT licence in `LICENSE` is not a substitute.
- [ ] **Export-control questionnaire** — the standard "does this contain
  crypto" form. Tower Stack only uses Web Crypto for random numbers, so the
  answer is "uses TLS / standard crypto" → no special licence required.
- [ ] **Anti-cheat declaration** — Tower Stack ships no anti-cheat. Tick
  "no anti-cheat" on the form.

### Server-cost planning
Cloudflare Workers + Durable Objects on the free tier give you:
- 100k requests/day
- 1k Durable Object requests/day (free), or pay-as-you-go (~ $0.15 / M)
- WebSocket connection-minutes counted only while a message is in flight
  thanks to the Hibernation API.

For an indie launch this is essentially free; plan to upgrade to the $5/mo
Workers Paid plan before launch to lift the daily caps.

---

## Itch.io — required before you can ship

Itch is much lighter than Steam. Concrete steps:
- [ ] Free Itch.io account.
- [ ] Create a new project → **Kind of project: Downloadable**.
- [ ] Upload one zip per OS: `tower-stack-win.zip`, `tower-stack-mac.zip`,
  `tower-stack-linux.zip`. Mark each with the correct platform checkbox so
  the Itch app routes installs.
- [ ] Optionally also publish as **HTML5**: zip `client/dist/` and upload
  with "this file will be played in the browser" — but the game requires
  the multiplayer Worker URL be reachable.
- [ ] Cover image: 630 × 500 minimum.
- [ ] Screenshots: 3 or more, 1280×720+.
- [ ] Short description, tags, classification (Game / Multiplayer / Casual).
- [ ] Pricing model: free / pay-what-you-want / fixed price. Itch's revenue
  share is configurable (default 10% to Itch).

Itch has no per-app fee. You can publish a build today.

---

## Recommended pre-launch polish (not strictly required)

These would clearly improve the player experience but are not blockers:
- [ ] Steam Input controller support (so the desktop build feels native with
  a gamepad). Tauri webview gets gamepad events for free via the standard
  Gamepad API, but you'd need to wire them into `Input.ts`.
- [ ] Local same-screen multiplayer (hotseat). Currently every player needs
  their own client.
- [ ] Persisted player profile (name, win/loss). Currently we save the name
  in `localStorage`; bumping that into Steam Cloud is a few hours of work.
- [ ] Server region selection. Cloudflare auto-routes to the nearest edge,
  but exposing a "host in EU/US/Asia" hint to the UI helps clarity for
  cross-region rooms.
- [ ] Replay / spectator-mode polish (the spectator pipeline already exists
  on the server — just needs UI affordance).

---

## Server checklist before public launch

- [ ] **Custom domain** for the Worker (`wrangler.toml` → `routes`). Otherwise
  you're shipping a `*.workers.dev` URL embedded in the binary, which works
  but looks unprofessional.
- [ ] **Rate-limit `POST /api/rooms`** (one room per IP per minute is plenty)
  via Cloudflare's built-in Rate Limiting Rules.
- [ ] **Set up an alert** for Durable Object error spikes — Cloudflare's
  Workers Observability tab.
- [ ] **Privacy-policy URL** wired into the desktop build's About dialog
  (currently only an `homepage` field in `tauri.conf.json`).
