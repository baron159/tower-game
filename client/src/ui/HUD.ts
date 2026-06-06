// On-canvas UI overlay. Plain DOM — no framework — so the bundle stays small
// and the build process stays one-step.

import type { Card, PlayerInfo, RoomState } from "../../../shared/protocol";
import { getCardTexture } from "../assets/Textures";
import { buildBlockCatalogue } from "../../../shared/protocol";

const blockDefs = buildBlockCatalogue();

export interface HudCallbacks {
  onStart: () => void;
  onDraw: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRematch: () => void;
  onChat: (text: string) => void;
  onCopyCode: () => void;
}

export class HUD {
  private root: HTMLElement;
  private statusEl: HTMLElement;
  private playersEl: HTMLElement;
  private cardEl: HTMLElement;
  private actionsEl: HTMLElement;
  private toastEl: HTMLElement;
  private endEl: HTMLElement;
  private cb: HudCallbacks;
  private me: PlayerInfo | null = null;

  constructor(uiRoot: HTMLElement, cb: HudCallbacks) {
    this.cb = cb;
    this.root = uiRoot;
    this.root.innerHTML = `
      <style>
        .hud-top { position:absolute; top:14px; left:14px; right:14px; display:flex; justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap; font: 13px/1.4 system-ui, -apple-system, sans-serif; }
        .hud-card { background:rgba(8,20,16,0.75); backdrop-filter: blur(8px); border:1px solid rgba(159,225,203,0.18); border-radius:12px; padding:12px 14px; min-width:220px; color:#e1f5ee; }
        .hud-card h3 { margin:0 0 8px; font-size:11px; text-transform:uppercase; letter-spacing:0.10em; color:#9fe1cb; font-weight:600; }
        .hud-card .room-code { font: 700 22px/1 ui-monospace, "SF Mono", monospace; color:#fff; letter-spacing:0.06em; cursor:pointer; }
        .hud-card .room-code:hover { color:#9fe1cb; }
        .player-row { display:flex; justify-content:space-between; padding:3px 0; }
        .player-row.turn { color:#9fe1cb; font-weight:600; }
        .player-row.offline { opacity:0.45; text-decoration:line-through; }
        .player-row.me::after { content:" (you)"; opacity:0.6; }
        .card-area { position:absolute; bottom:24px; right:24px; display:flex; flex-direction:column; align-items:flex-end; gap:14px; }
        .card-display { width:180px; height:252px; border-radius:10px; box-shadow:0 8px 32px rgba(0,0,0,0.55); background:#888; transition:transform 0.2s; }
        .card-display.draw-anim { transform: translateY(20px) rotate(-5deg) scale(0.95); opacity:0; }
        .card-display.shown { transform: translateY(0) rotate(0) scale(1); opacity:1; }
        .actions { display:flex; gap:8px; }
        .btn { background:#1d9e75; color:#fff; border:none; border-radius:8px; padding:10px 16px; font:600 13px/1 system-ui, sans-serif; cursor:pointer; box-shadow:0 4px 16px rgba(29,158,117,0.35); }
        .btn:hover { background:#23b585; }
        .btn:disabled { background:#2d4a40; color:#7a9890; cursor:not-allowed; box-shadow:none; }
        .btn.secondary { background:rgba(255,255,255,0.10); color:#e1f5ee; box-shadow:none; }
        .btn.secondary:hover { background:rgba(255,255,255,0.18); }
        .btn.danger { background:#a32d2d; }
        .toast { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(8,20,16,0.92); border:1px solid rgba(159,225,203,0.25); border-radius:14px; padding:18px 26px; color:#fff; font:500 16px/1.4 system-ui, sans-serif; text-align:center; transition:opacity 0.3s; opacity:0; pointer-events:none; max-width:80vw; }
        .toast.show { opacity:1; }
        .end-screen { position:absolute; inset:0; display:none; align-items:center; justify-content:center; background:rgba(8,20,16,0.72); backdrop-filter:blur(8px); z-index:5; }
        .end-screen.show { display:flex; }
        .end-card { background:rgba(20,38,30,0.96); border:1px solid rgba(159,225,203,0.20); border-radius:18px; padding:32px 40px; text-align:center; max-width:420px; }
        .end-card h2 { margin:0 0 8px; font-size:28px; color:#fff; }
        .end-card p { color:#9fe1cb; margin:0 0 20px; }
        .controls-help { position:absolute; left:14px; bottom:14px; background:rgba(8,20,16,0.70); border-radius:10px; padding:10px 14px; color:#c5e7d8; font:12px/1.5 system-ui, sans-serif; max-width:280px; }
        .controls-help b { color:#9fe1cb; }
      </style>
      <div class="hud-top">
        <div class="hud-card" id="hud-room">
          <h3>Room</h3>
          <div class="room-code" id="hud-room-code" title="Click to copy">······</div>
        </div>
        <div class="hud-card" id="hud-status">
          <h3>Status</h3>
          <div id="hud-status-text">Connecting…</div>
        </div>
        <div class="hud-card" id="hud-players">
          <h3>Players</h3>
          <div id="hud-players-list"></div>
        </div>
      </div>

      <div class="card-area" id="hud-card-area">
        <div class="card-display draw-anim" id="hud-card"></div>
        <div class="actions" id="hud-actions"></div>
      </div>

      <div class="controls-help">
        <b>Controls:</b> drag to orbit · scroll to zoom · click block to pick up · move mouse to position · click again to drop · Q/E to rotate held block
      </div>

      <div class="toast" id="hud-toast"></div>
      <div class="end-screen" id="hud-end">
        <div class="end-card" id="hud-end-card"></div>
      </div>
    `;
    this.statusEl = this.root.querySelector("#hud-status-text")!;
    this.playersEl = this.root.querySelector("#hud-players-list")!;
    this.cardEl = this.root.querySelector("#hud-card")!;
    this.actionsEl = this.root.querySelector("#hud-actions")!;
    this.toastEl = this.root.querySelector("#hud-toast")!;
    this.endEl = this.root.querySelector("#hud-end")!;
    this.root.querySelector("#hud-room-code")!.addEventListener("click", () => cb.onCopyCode());
  }

  setMe(me: PlayerInfo) { this.me = me; }

  showRoomCode(code: string) {
    (this.root.querySelector("#hud-room-code") as HTMLElement).textContent = code;
  }

  toast(text: string, ms = 2200) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add("show");
    setTimeout(() => this.toastEl.classList.remove("show"), ms);
  }

  showState(state: RoomState, holdingBlock: boolean) {
    // Players panel
    this.playersEl.innerHTML = "";
    for (const p of state.players) {
      const div = document.createElement("div");
      div.className = "player-row";
      if (state.currentTurnPlayerId === p.id) div.classList.add("turn");
      if (!p.connected) div.classList.add("offline");
      if (this.me && p.id === this.me.id) div.classList.add("me");
      div.innerHTML = `<span>${escapeHtml(p.name)}${p.isHost ? " ★" : ""}</span><span>${state.currentTurnPlayerId === p.id ? "▸" : ""}</span>`;
      this.playersEl.appendChild(div);
    }

    const isMyTurn = !!this.me && state.currentTurnPlayerId === this.me.id;
    const turnPlayer = state.players.find((p) => p.id === state.currentTurnPlayerId);
    let statusText = "";
    switch (state.phase) {
      case "lobby":
        statusText = state.players.length < 2
          ? "Waiting for at least 2 players to join…"
          : (this.me?.isHost ? "Press Start to begin." : "Waiting for host to start.");
        break;
      case "playing":
        statusText = isMyTurn
          ? (state.activeCard ? `Your turn — resolve: ${cardLabel(state.activeCard)}` : "Your turn — draw a card.")
          : `${turnPlayer?.name ?? "?"}'s turn`;
        break;
      case "collapsed":
        statusText = "The tower fell.";
        break;
      case "finished":
        statusText = state.loserId
          ? `${state.players.find((p) => p.id === state.loserId)?.name ?? "?"} knocked it down.`
          : "Deck exhausted — everyone wins!";
        break;
    }
    this.statusEl.textContent = statusText;

    // Card display
    this.renderCard(state.activeCard);

    // Actions
    this.actionsEl.innerHTML = "";
    if (state.phase === "lobby") {
      if (this.me?.isHost) {
        const btn = makeButton("Start game", () => this.cb.onStart());
        btn.disabled = state.players.length < 2;
        this.actionsEl.appendChild(btn);
      }
    } else if (state.phase === "playing" && isMyTurn) {
      if (!state.activeCard) {
        this.actionsEl.appendChild(makeButton("Draw card", () => this.cb.onDraw()));
      } else if (state.activeCard.kind === "build" || state.activeCard.kind === "move") {
        const confirm = makeButton("Confirm placement", () => this.cb.onConfirm());
        confirm.disabled = !holdingBlock && state.activeCard.kind === "build";
        this.actionsEl.appendChild(confirm);
        const cancel = makeButton("Cancel", () => this.cb.onCancel());
        cancel.classList.add("secondary");
        this.actionsEl.appendChild(cancel);
      }
    } else if (state.phase === "finished" || state.phase === "collapsed") {
      // End screen handles this.
    }
  }

  private renderCard(card: Card | null) {
    if (!card) {
      this.cardEl.style.background = "rgba(15,30,24,0.5)";
      this.cardEl.style.backgroundImage = "";
      this.cardEl.classList.remove("shown");
      this.cardEl.classList.add("draw-anim");
      return;
    }
    const def = blockDefs[card.blockIndex] ?? blockDefs[0];
    const tex = getCardTexture({
      kind: card.kind,
      blockId: card.kind === "build" ? def.id : 0,
      hue: card.kind === "build" ? def.hue : 0.3,
    });
    const data = (tex.image as HTMLCanvasElement).toDataURL();
    this.cardEl.style.backgroundImage = `url(${data})`;
    this.cardEl.style.backgroundSize = "cover";
    this.cardEl.classList.remove("draw-anim");
    this.cardEl.classList.add("shown");
  }

  showEndScreen(state: RoomState) {
    if (!this.me) return;
    const iLost = state.loserId === this.me.id;
    const winners = state.players.filter((p) => p.id !== state.loserId).map((p) => p.name).join(", ");
    const card = this.root.querySelector("#hud-end-card") as HTMLElement;
    card.innerHTML = `
      <h2>${state.loserId ? (iLost ? "You knocked it down" : "Tower toppled!") : "Deck exhausted!"}</h2>
      <p>${state.loserId ? `Winners: ${escapeHtml(winners)}` : "Everyone survived. You all win."}</p>
      <div class="actions" style="justify-content:center;">
        ${this.me.isHost ? '<button class="btn" id="end-rematch">Rematch</button>' : '<div style="color:#9fe1cb;">Waiting for host…</div>'}
      </div>
    `;
    const r = card.querySelector("#end-rematch") as HTMLButtonElement | null;
    if (r) r.onclick = () => { this.endEl.classList.remove("show"); this.cb.onRematch(); };
    this.endEl.classList.add("show");
  }

  hideEndScreen() { this.endEl.classList.remove("show"); }
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "btn";
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function cardLabel(c: Card): string {
  switch (c.kind) {
    case "build": return `Place block #${c.blockIndex + 1}`;
    case "move":  return "Move any block";
    case "skip":  return "Skip";
    case "draw2": return "Draw 2";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
