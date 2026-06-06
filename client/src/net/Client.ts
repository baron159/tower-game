// Thin WebSocket client wrapping the protocol. Reconnects on transient
// disconnects with exponential backoff, but stays simple — this is a turn-
// based game, not a twitch shooter.

import type { ClientMessage, ServerMessage } from "../../../shared/protocol";
import { PROTOCOL_VERSION } from "../../../shared/protocol";

export interface NetClient {
  send(msg: ClientMessage): void;
  close(): void;
  readonly connected: boolean;
  on<K extends ServerMessage["t"]>(
    type: K,
    fn: (m: Extract<ServerMessage, { t: K }>) => void,
  ): void;
  onAny(fn: (m: ServerMessage) => void): void;
  onOpen(fn: () => void): void;
  onClose(fn: (code: number, reason: string) => void): void;
}

export function connect(roomCode: string, name: string): NetClient {
  const url = wsUrlFor(roomCode);
  let ws: WebSocket | null = null;
  let connected = false;
  let closedByUser = false;
  let backoff = 500;

  // Listener buckets keyed by message type. We store unknown to sidestep the
  // contravariant function-narrowing issue with the discriminated union.
  const typed: { [k: string]: Array<(m: ServerMessage) => void> } = {};
  const anyListeners: Array<(m: ServerMessage) => void> = [];
  const openListeners: Array<() => void> = [];
  const closeListeners: Array<(code: number, reason: string) => void> = [];

  function open() {
    ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      connected = true;
      backoff = 500;
      ws!.send(JSON.stringify({ t: "hello", name, version: PROTOCOL_VERSION } as ClientMessage));
      for (const f of openListeners) f();
    });
    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const list = typed[msg.t];
      if (list) for (const f of list) f(msg);
      for (const f of anyListeners) f(msg);
    });
    ws.addEventListener("close", (ev) => {
      connected = false;
      for (const f of closeListeners) f(ev.code, ev.reason);
      if (!closedByUser) {
        const delay = Math.min(backoff, 8000);
        backoff *= 2;
        setTimeout(open, delay);
      }
    });
    ws.addEventListener("error", () => { /* close will follow */ });
  }
  open();

  return {
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    close() {
      closedByUser = true;
      ws?.close(1000, "client closed");
    },
    get connected() { return connected; },
    on(type, fn) {
      (typed[type] ??= []).push(fn as (m: ServerMessage) => void);
    },
    onAny(fn) { anyListeners.push(fn); },
    onOpen(fn) { openListeners.push(fn); },
    onClose(fn) { closeListeners.push(fn); },
  };
}

// Resolve the server base URL. In the browser dev/preview build we want
// same-origin so Vite can proxy; in Tauri (where the page loads from
// tauri://localhost) or when explicitly configured, we use VITE_SERVER_URL.
function serverBase(): { http: string; ws: string } {
  const explicit = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (explicit && explicit.trim()) {
    const trimmed = explicit.replace(/\/$/, "");
    return { http: trimmed, ws: trimmed.replace(/^http/, "ws") };
  }
  const loc = window.location;
  // tauri://localhost (Tauri) and capacitor:// (mobile) won't accept a relative
  // fetch — bail out with a clear error so users know to configure the env.
  if (loc.protocol !== "http:" && loc.protocol !== "https:") {
    throw new Error(
      "VITE_SERVER_URL is not set. In a desktop build you must point the " +
      "client at your deployed Cloudflare Worker (e.g. " +
      "VITE_SERVER_URL=https://tower-stack.<sub>.workers.dev).",
    );
  }
  const wsProto = loc.protocol === "https:" ? "wss:" : "ws:";
  return { http: `${loc.protocol}//${loc.host}`, ws: `${wsProto}//${loc.host}` };
}

function wsUrlFor(roomCode: string): string {
  return `${serverBase().ws}/ws/${roomCode}`;
}

export async function createRoom(): Promise<string> {
  const res = await fetch(`${serverBase().http}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to create room (${res.status})`);
  const data = (await res.json()) as { roomCode: string };
  return data.roomCode;
}
