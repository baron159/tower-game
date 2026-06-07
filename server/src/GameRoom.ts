// GameRoom — one Durable Object instance per active room.
//
// Uses Cloudflare's WebSocket Hibernation API: the DO can be evicted from
// memory between messages without dropping client connections. This keeps a
// long-running lobby essentially free until somebody acts.
//
// Authority model:
//   - The server owns: turn order, the deck, whose turn it is, whether the
//     tower has collapsed (the active player reports this).
//   - The active player's client owns: live physics simulation. They tick
//     block snapshots up to the server which fans them out to spectators.
//     Because only one player manipulates blocks at a time this is safe.

import {
  PROTOCOL_VERSION,
  type Card,
  type CardKind,
  type ClientMessage,
  type PlayerInfo,
  type RoomState,
  type ServerMessage,
  type BlockSnapshot,
  buildBlockCatalogue,
  DEFAULT_DECK_SIZE,
} from "../../shared/protocol";

interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

// Persisted server-only state.
interface PersistedRoom {
  code: string;
  phase: RoomState["phase"];
  players: PlayerInfo[];
  turnIndex: number;
  deck: Card[];           // Server-secret. Index 0 is bottom; we draw from end.
  activeCard: Card | null;
  pendingCards: Card[];
  blocks: BlockSnapshot[];
  loserId: string | null;
}

// In-memory only — rebuilt on every message because of hibernation.
interface SocketAttachment {
  playerId: string;
}

export class GameRoom implements DurableObject {
  private state: DurableObjectState;
  private room: PersistedRoom | null = null;
  private blocks = buildBlockCatalogue();

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    // Restore on startup. blockConcurrencyWhile guards against incoming
    // requests while we read.
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<PersistedRoom>("room");
      if (stored) this.room = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/init") {
      const code = url.searchParams.get("code") ?? "AAAAAA";
      if (!this.room) {
        this.room = this.freshRoom(code);
        await this.persist();
      }
      return new Response("ok");
    }

    // WebSocket upgrade.
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Generate a player id eagerly so we can attach it to the socket. The
    // 'hello' handshake will associate name + reconnection.
    const playerId = crypto.randomUUID();
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ playerId } satisfies SocketAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation handler — invoked whenever any socket on this DO receives
  // a message, even if the DO was previously hibernated.
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    const attach = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attach) {
      ws.close(1011, "no attachment");
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.sendError(ws, "bad_json", "Could not parse message");
      return;
    }
    try {
      await this.handle(ws, attach.playerId, msg);
    } catch (e) {
      this.sendError(ws, "internal", (e as Error).message);
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const attach = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attach || !this.room) return;
    const p = this.room.players.find((p) => p.id === attach.playerId);
    if (p) p.connected = false;
    // If the active turn player drops, advance the turn so the game doesn't stall.
    if (this.room.phase === "playing") {
      const turnPlayer = this.activePlayerId();
      if (turnPlayer === attach.playerId) {
        this.advanceTurn();
        this.room.activeCard = null;
        this.room.pendingCards = [];
      }
    }
    await this.persist();
    this.broadcastState();
  }

  async webSocketError(ws: WebSocket, _err: unknown): Promise<void> {
    await this.webSocketClose(ws, 1011, "error", false);
  }

  // ===== Message handlers =====

  private async handle(ws: WebSocket, playerId: string, msg: ClientMessage) {
    if (!this.room) {
      this.sendError(ws, "no_room", "Room not initialised");
      return;
    }
    switch (msg.t) {
      case "hello": {
        if (msg.version !== PROTOCOL_VERSION) {
          this.sendError(ws, "version", `Server protocol ${PROTOCOL_VERSION}, client ${msg.version}`);
          ws.close(1002, "version mismatch");
          return;
        }
        const existing = this.room.players.find((p) => p.id === playerId);
        if (existing) {
          existing.connected = true;
          existing.name = msg.name.slice(0, 24) || existing.name;
        } else {
          const isHost = this.room.players.length === 0;
          const p: PlayerInfo = {
            id: playerId,
            name: msg.name.slice(0, 24) || `Player ${this.room.players.length + 1}`,
            connected: true,
            isHost,
          };
          this.room.players.push(p);
        }
        await this.persist();
        const you = this.room.players.find((p) => p.id === playerId)!;
        this.sendTo(ws, { t: "welcome", you, state: this.snapshot() });
        this.broadcastState();
        return;
      }

      case "startGame": {
        const player = this.room.players.find((p) => p.id === playerId);
        if (!player?.isHost) {
          this.sendError(ws, "not_host", "Only the host can start the game.");
          return;
        }
        if (this.room.players.length < 2) {
          this.sendError(ws, "need_players", "Need at least 2 players.");
          return;
        }
        if (this.room.phase !== "lobby" && this.room.phase !== "finished") {
          this.sendError(ws, "bad_phase", "Game already in progress.");
          return;
        }
        this.startGame();
        await this.persist();
        this.broadcastState();
        return;
      }

      case "drawCard": {
        if (this.room.phase !== "playing") return;
        if (this.activePlayerId() !== playerId) {
          this.sendError(ws, "not_your_turn", "Wait your turn.");
          return;
        }
        if (this.room.activeCard) {
          this.sendError(ws, "already_drawn", "You already drew this turn.");
          return;
        }
        const card = this.room.deck.pop();
        if (!card) {
          // Deck ran out — the tower survived. Everyone wins.
          this.room.phase = "finished";
          this.room.loserId = null;
        } else {
          this.applyDrawnCard(card);
        }
        await this.persist();
        this.broadcastState();
        return;
      }

      case "resolveCard": {
        if (this.room.phase !== "playing") return;
        if (this.activePlayerId() !== playerId) return;
        if (!this.room.activeCard || this.room.activeCard.id !== msg.cardId) {
          this.sendError(ws, "no_active_card", "No matching active card.");
          return;
        }
        // Trust the client's final block snapshot. (Anti-cheat would diff
        // this against the simulation, out of scope for the MVP.)
        this.room.blocks = msg.blocks;
        this.room.activeCard = null;
        // If there are pending cards (Draw 2 stack), promote the next one.
        const next = this.room.pendingCards.shift();
        if (next) {
          this.applyDrawnCard(next);
        } else {
          this.advanceTurn();
        }
        await this.persist();
        this.broadcastState();
        return;
      }

      case "reportCollapse": {
        if (this.room.phase !== "playing") return;
        if (this.activePlayerId() !== playerId) return;
        this.room.blocks = msg.blocks;
        this.room.phase = "collapsed";
        this.room.loserId = playerId;
        // Brief delay before "finished" so clients can show the crash.
        await this.persist();
        this.broadcastState();
        this.state.storage.setAlarm(Date.now() + 4000);
        return;
      }

      case "blockTick": {
        if (this.room.phase !== "playing") return;
        if (this.activePlayerId() !== playerId) return;
        // Forward verbatim without persisting — these are just visual.
        const tick: ServerMessage = { t: "tick", blocks: msg.blocks, fromPlayerId: playerId };
        this.broadcastExcept(playerId, tick);
        return;
      }

      case "chat": {
        const text = msg.text.slice(0, 200);
        const out: ServerMessage = { t: "chat", fromPlayerId: playerId, text, ts: Date.now() };
        this.broadcast(out);
        return;
      }

      case "rematch": {
        const player = this.room.players.find((p) => p.id === playerId);
        if (!player?.isHost) return;
        if (this.room.phase !== "finished" && this.room.phase !== "collapsed") return;
        this.startGame();
        await this.persist();
        this.broadcastState();
        return;
      }

      case "ping": {
        this.sendTo(ws, { t: "pong", nonce: msg.nonce, serverTime: Date.now() });
        return;
      }

      case "createRoom":
      case "joinRoom":
        // These are stateless URL paths in our model; the worker routes by
        // path. If a client sends them on a connected socket, just ignore.
        return;
    }
  }

  async alarm(): Promise<void> {
    if (!this.room) return;
    if (this.room.phase === "collapsed") {
      this.room.phase = "finished";
      await this.persist();
      this.broadcastState();
    }
  }

  // ===== Game logic =====

  private freshRoom(code: string): PersistedRoom {
    return {
      code,
      phase: "lobby",
      players: [],
      turnIndex: 0,
      deck: [],
      activeCard: null,
      pendingCards: [],
      blocks: [],
      loserId: null,
    };
  }

  private startGame() {
    if (!this.room) return;
    this.room.deck = buildShuffledDeck(DEFAULT_DECK_SIZE);
    this.room.phase = "playing";
    this.room.turnIndex = 0;
    this.room.activeCard = null;
    this.room.pendingCards = [];
    this.room.loserId = null;
    // Seed the base layer of blocks. The first three slabs form the foundation
    // sitting on the tower stand at y ≈ 0.
    this.room.blocks = this.blocks.map((b) => ({
      id: b.id,
      x: 0, y: -2, z: 0, // off-screen "supply pile"
      qx: 0, qy: 0, qz: 0, qw: 1,
      placed: false,
    }));
    // Place the first 3 slabs on the stand so there's something to balance on.
    // Stand top sits at y = 0.27 (cylinder at y=0.24 with half-height 0.03).
    // Each slab has half-height 0.13, so consecutive y values clear of
    // interpenetration are 0.40, 0.66, 0.92 (touching but not overlapping).
    const base = BASE_BLOCK_IDS; // canonical slab base
    base.forEach((i, idx) => {
      const b = this.room!.blocks[i];
      b.x = 0;
      b.y = 0.40 + idx * 0.26;
      b.z = 0;
      b.placed = true;
    });
  }

  private applyDrawnCard(card: Card) {
    if (!this.room) return;
    this.room.activeCard = card;
    if (card.kind === "skip") {
      // Skip resolves immediately on the server side; turn advances.
      this.room.activeCard = null;
      const next = this.room.pendingCards.shift();
      if (next) {
        this.applyDrawnCard(next);
      } else {
        this.advanceTurn();
      }
      return;
    }
    if (card.kind === "draw2") {
      // Pop two more cards and queue them; turn does not advance yet.
      const c1 = this.room.deck.pop();
      const c2 = this.room.deck.pop();
      this.room.activeCard = null;
      if (c1) this.room.pendingCards.push(c1);
      if (c2) this.room.pendingCards.push(c2);
      const next = this.room.pendingCards.shift();
      if (next) this.applyDrawnCard(next);
      else this.advanceTurn();
      return;
    }
    // build / move stay as activeCard for the client to resolve.
  }

  private advanceTurn() {
    if (!this.room) return;
    if (this.room.players.length === 0) return;
    // Skip disconnected players. Keep at most one full rotation to avoid loops.
    for (let i = 0; i < this.room.players.length; i++) {
      this.room.turnIndex = (this.room.turnIndex + 1) % this.room.players.length;
      if (this.room.players[this.room.turnIndex].connected) return;
    }
  }

  private activePlayerId(): string | null {
    if (!this.room || this.room.players.length === 0) return null;
    return this.room.players[this.room.turnIndex]?.id ?? null;
  }

  private snapshot(): RoomState {
    const r = this.room!;
    return {
      roomCode: r.code,
      phase: r.phase,
      players: r.players.map((p) => ({ ...p })),
      currentTurnPlayerId: this.activePlayerId(),
      deckRemaining: r.deck.length,
      activeCard: r.activeCard,
      pendingCards: r.pendingCards.slice(),
      blocks: r.blocks.map((b) => ({ ...b })),
      loserId: r.loserId,
      serverTime: Date.now(),
    };
  }

  private async persist() {
    if (!this.room) return;
    await this.state.storage.put("room", this.room);
  }

  // ===== Socket fan-out =====

  private allSockets(): WebSocket[] {
    return this.state.getWebSockets();
  }

  private sendTo(ws: WebSocket, msg: ServerMessage) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket dead */ }
  }

  private sendError(ws: WebSocket, code: string, message: string) {
    this.sendTo(ws, { t: "error", code, message });
  }

  private broadcast(msg: ServerMessage) {
    const json = JSON.stringify(msg);
    for (const ws of this.allSockets()) {
      try { ws.send(json); } catch { /* dead socket */ }
    }
  }

  private broadcastExcept(playerId: string, msg: ServerMessage) {
    const json = JSON.stringify(msg);
    for (const ws of this.allSockets()) {
      const attach = ws.deserializeAttachment() as SocketAttachment | null;
      if (attach?.playerId === playerId) continue;
      try { ws.send(json); } catch { /* dead socket */ }
    }
  }

  private broadcastState() {
    this.broadcast({ t: "state", state: this.snapshot() });
  }
}

// Three slabs pre-placed on the stand at game-start.
const BASE_BLOCK_IDS: ReadonlyArray<number> = [0, 3, 6];

// Fisher–Yates with crypto randomness so a clever client can't predict the deck.
function buildShuffledDeck(size: number): Card[] {
  const cards: Card[] = [];
  const blocks = buildBlockCatalogue();
  // Build cards only address blocks that aren't already on the stand —
  // otherwise the active player would draw a card pointing at a block that
  // can't be picked up.
  const eligible = blocks.filter((b) => !BASE_BLOCK_IDS.includes(b.id));
  // Composition (44-card v2 deck): 28 build, 8 move, 4 skip, 4 draw2.
  const buildCount = Math.floor(size * 0.63);
  const moveCount = Math.floor(size * 0.18);
  const skipCount = Math.floor(size * 0.09);
  const draw2Count = size - buildCount - moveCount - skipCount;
  const push = (kind: CardKind, idx: number) =>
    cards.push({ id: crypto.randomUUID(), kind, blockIndex: idx });
  for (let i = 0; i < buildCount; i++) push("build", eligible[i % eligible.length].id);
  for (let i = 0; i < moveCount; i++) push("move", -1);
  for (let i = 0; i < skipCount; i++) push("skip", -1);
  for (let i = 0; i < draw2Count; i++) push("draw2", -1);
  const rnd = crypto.getRandomValues(new Uint32Array(cards.length));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
