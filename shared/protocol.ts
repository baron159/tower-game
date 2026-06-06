// Wire protocol shared between Cloudflare Worker server and Three.js client.
// Keep this file dependency-free so it can be symlinked / copied into both
// workspaces. Bump PROTOCOL_VERSION on any breaking change.

export const PROTOCOL_VERSION = 1;

export type CardKind = "build" | "move" | "skip" | "draw2";

export interface Card {
  id: string;
  kind: CardKind;
  // For "build" cards: which block index from the canonical block list
  // matches the picture on the card. -1 for non-build cards.
  blockIndex: number;
}

export interface BlockSnapshot {
  id: number;
  // Position
  x: number; y: number; z: number;
  // Quaternion
  qx: number; qy: number; qz: number; qw: number;
  placed: boolean;
}

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
}

export type GamePhase =
  | "lobby"
  | "playing"
  | "collapsed"
  | "finished";

export interface RoomState {
  roomCode: string;
  phase: GamePhase;
  players: PlayerInfo[];
  currentTurnPlayerId: string | null;
  // Top of deck count, not contents (deck is server-secret).
  deckRemaining: number;
  // The card currently being resolved by the active player, if any.
  activeCard: Card | null;
  // Stack of cards still to resolve for the active player (Draw 2 etc).
  pendingCards: Card[];
  blocks: BlockSnapshot[];
  // Player who caused the collapse, if phase === collapsed | finished.
  loserId: string | null;
  // ISO timestamp of last server update — used for debugging clock skew.
  serverTime: number;
}

// ===== Client -> Server messages =====
export type ClientMessage =
  | { t: "hello"; name: string; version: number }
  | { t: "createRoom"; name: string }
  | { t: "joinRoom"; roomCode: string; name: string }
  | { t: "startGame" }
  | { t: "drawCard" } // Active player draws the top card.
  | { t: "resolveCard"; cardId: string; blocks: BlockSnapshot[] }
  | { t: "reportCollapse"; blocks: BlockSnapshot[] }
  // Lightweight position broadcast during the active player's manipulation
  // so spectators see the wobble in near-real-time. Server forwards verbatim.
  | { t: "blockTick"; blocks: BlockSnapshot[] }
  | { t: "chat"; text: string }
  | { t: "rematch" }
  | { t: "ping"; nonce: number };

// ===== Server -> Client messages =====
export type ServerMessage =
  | { t: "welcome"; you: PlayerInfo; state: RoomState }
  | { t: "state"; state: RoomState }
  | { t: "tick"; blocks: BlockSnapshot[]; fromPlayerId: string }
  | { t: "chat"; fromPlayerId: string; text: string; ts: number }
  | { t: "error"; code: string; message: string }
  | { t: "pong"; nonce: number; serverTime: number };

// ===== Canonical block catalogue =====
// 32 blocks total (v2 component count) — each has a deterministic shape.
// We generate a mild visual variety with three primitive shapes so cards can
// match block "pictures" without external art. Dimensions are in metres.
export interface BlockDef {
  id: number;
  shape: "slab" | "cube" | "wedge";
  // Half extents for collision (box approx for all shapes).
  hx: number; hy: number; hz: number;
  // Hue 0..1 for procedural texture so each block looks distinct.
  hue: number;
}

export const BLOCK_COUNT = 32;
export const DEFAULT_DECK_SIZE = 44; // v2 deck

// Deterministic block catalogue. Keeps client + server agreeing on shape
// without shipping data files.
export function buildBlockCatalogue(): BlockDef[] {
  const out: BlockDef[] = [];
  for (let i = 0; i < BLOCK_COUNT; i++) {
    const cycle = i % 3;
    const shape: BlockDef["shape"] =
      cycle === 0 ? "slab" : cycle === 1 ? "cube" : "wedge";
    const hx = shape === "slab" ? 0.55 : shape === "cube" ? 0.32 : 0.45;
    const hy = shape === "slab" ? 0.13 : shape === "cube" ? 0.32 : 0.18;
    const hz = shape === "slab" ? 0.30 : shape === "cube" ? 0.32 : 0.30;
    // Spread hue around the wheel so adjacent blocks contrast.
    const hue = (i * 0.137) % 1;
    out.push({ id: i, shape, hx, hy, hz, hue });
  }
  return out;
}
