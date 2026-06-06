// Cloudflare Worker entrypoint.
//
// Two responsibilities:
//   1. WebSocket upgrade on /ws/:roomCode -> route to the matching GameRoom DO
//   2. Generate a fresh room code on POST /api/rooms
//
// Static asset serving (the built Three.js client) is handled by the
// [assets] binding declared in wrangler.toml, so this worker only handles
// API + WebSocket paths.

export { GameRoom } from "./GameRoom";

interface Env {
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

// Url-safe room codes. Avoids ambiguous chars (0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateRoomCode(): string {
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

function cors(headers: Headers = new Headers()): Headers {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return headers;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    // Health probe — Steam build script uses this to verify the server is up.
    if (url.pathname === "/api/health") {
      return new Response(
        JSON.stringify({ ok: true, time: Date.now() }),
        { headers: cors(new Headers({ "Content-Type": "application/json" })) },
      );
    }

    // Create a new room. Returns { roomCode } so the client can build the
    // ws URL themselves.
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const code = generateRoomCode();
      // Touch the DO so it exists and seeds itself before the first client
      // arrives. This avoids a race when host + first guest open the room
      // socket simultaneously.
      const id = env.GAME_ROOM.idFromName(code);
      const stub = env.GAME_ROOM.get(id);
      await stub.fetch(`https://internal/init?code=${code}`);
      return new Response(
        JSON.stringify({ roomCode: code }),
        { headers: cors(new Headers({ "Content-Type": "application/json" })) },
      );
    }

    // WebSocket upgrade for a room.
    const wsMatch = url.pathname.match(/^\/ws\/([A-Z0-9]{4,16})$/);
    if (wsMatch) {
      const code = wsMatch[1];
      const id = env.GAME_ROOM.idFromName(code);
      const stub = env.GAME_ROOM.get(id);
      // Pass the original request through so the DO can call
      // acceptWebSocket() with the upgraded socket.
      return stub.fetch(request);
    }

    // Fall through to the static asset binding for the SPA. If the asset
    // binding is missing (e.g. running the worker without a build), return a
    // friendly hint instead of a 500.
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response(
      "Tower Stack server running. Build the client and re-deploy to serve it from here.",
      { status: 200, headers: cors() },
    );
  },
};
