/**
 * SecureGate WebSocket Gateway
 *
 * Sits between the frontend and OpenClaw:
 *   Frontend (Auth0 JWT) ──WS──► This Gateway ──WS──► OpenClaw (:18789)
 *
 * - Validates Auth0 JWTs using JWKS
 * - Creates per-user OpenClaw connections
 * - Forwards queries and streams responses
 * - Token store: holds Auth0 JWTs in memory for the Agent Service to use
 */

import "dotenv/config";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { OpenClawConnection } from "./openclaw-client.mjs";

// ── Config ──

const PORT = parseInt(process.env.WS_PORT || "8002", 10);
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || "";
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || "";
const OPENCLAW_WS_URL =
  process.env.OPENCLAW_WS_URL || "ws://127.0.0.1:18789";
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN || "";

if (!AUTH0_DOMAIN || !AUTH0_AUDIENCE || !OPENCLAW_TOKEN) {
  console.error(
    "Missing required env vars: AUTH0_DOMAIN, AUTH0_AUDIENCE, OPENCLAW_TOKEN"
  );
  process.exit(1);
}

// ── Auth0 JWKS ──

const JWKS_URL = new URL(
  `https://${AUTH0_DOMAIN}/.well-known/jwks.json`
);
const jwks = createRemoteJWKSet(JWKS_URL);

async function validateAuth0Token(token) {
  const { payload } = await jwtVerify(token, jwks, {
    audience: AUTH0_AUDIENCE,
    issuer: `https://${AUTH0_DOMAIN}/`,
    algorithms: ["RS256"],
  });
  return { ...payload, _rawToken: token };
}

// ── Token Store (in-memory, per-session) ──

/** @type {Map<string, { token: string, email: string, storedAt: number }>} */
const tokenStore = new Map();

function storeToken(userId, token, email) {
  tokenStore.set(userId, { token, email, storedAt: Date.now() });
  // Also store under "default" so agent service can find it without knowing userId
  tokenStore.set("default", { token, email, storedAt: Date.now() });
  console.log(`[token-store] Stored token for ${email} (${userId})`);
}

function removeToken(userId) {
  tokenStore.delete(userId);
  // If "default" points to this user, clear it too
  const def = tokenStore.get("default");
  if (def && tokenStore.get(userId)?.email === def.email) {
    tokenStore.delete("default");
  }
}

// ── HTTP Server (for token endpoint + WebSocket upgrade) ──

const httpServer = createServer((req, res) => {
  // Only allow localhost
  const remoteAddr = req.socket.remoteAddress;
  const isLocal =
    remoteAddr === "127.0.0.1" ||
    remoteAddr === "::1" ||
    remoteAddr === "::ffff:127.0.0.1";

  // CORS headers for agent service
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/token?user_id=xxx — Agent Service calls this to get the user's JWT
  if (req.method === "GET" && req.url?.startsWith("/api/token")) {
    if (!isLocal) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden — localhost only" }));
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const userId = url.searchParams.get("user_id") || "default";
    const entry = tokenStore.get(userId);

    if (!entry) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No token found for user" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ token: entry.token, email: entry.email }));
    return;
  }

  // GET /health
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        activeSessions: tokenStore.size,
        connectedClients: clients.size,
      })
    );
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ── WebSocket Server ──

const wss = new WebSocketServer({ server: httpServer });

/** @type {Map<import('ws').WebSocket, { ocConn: OpenClawConnection | null, user: any, authenticated: boolean }>} */
const clients = new Map();

wss.on("connection", (ws) => {
  console.log("[gateway] New client connected");

  const state = {
    ocConn: null,
    user: null,
    authenticated: false,
  };
  clients.set(ws, state);

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendError(ws, "Invalid JSON");
      return;
    }

    // ── Auth message (must be first) ──
    if (msg.type === "auth") {
      if (state.authenticated) {
        send(ws, { type: "authenticated", email: state.user?.email });
        return;
      }

      try {
        const payload = await validateAuth0Token(msg.token);
        state.user = payload;
        state.authenticated = true;

        // Store the token so Agent Service can use it
        storeToken(payload.sub, payload._rawToken, payload.email || payload.sub);

        // Create OpenClaw connection for this user
        state.ocConn = new OpenClawConnection({
          url: OPENCLAW_WS_URL,
          token: OPENCLAW_TOKEN,
          onEvent: (event) => {
            send(ws, { type: "event", event });
          },
        });

        await state.ocConn.connect();

        send(ws, {
          type: "authenticated",
          email: payload.email || payload.sub,
        });
        console.log(
          `[gateway] Authenticated: ${payload.email || payload.sub}`
        );
      } catch (err) {
        console.error("[gateway] Auth failed:", err.message);
        send(ws, { type: "auth_error", message: "Authentication failed" });
        ws.close(4001, "Authentication failed");
      }
      return;
    }

    // ── All other messages require auth ──
    if (!state.authenticated) {
      send(ws, {
        type: "auth_error",
        message: "Send auth message first",
      });
      return;
    }

    // ── Query message ──
    if (msg.type === "query") {
      if (!msg.message?.trim()) {
        sendError(ws, "Empty message");
        return;
      }

      send(ws, { type: "status", status: "thinking" });

      try {
        const result = await state.ocConn.query(msg.message);
        send(ws, {
          type: "response",
          text: result.text,
          meta: {
            durationMs: result.meta?.durationMs,
            model: result.meta?.agentMeta?.model,
            provider: result.meta?.agentMeta?.provider,
          },
        });
      } catch (err) {
        console.error("[gateway] Query error:", err.message);
        sendError(ws, err.message);
      }
      return;
    }

    sendError(ws, `Unknown message type: ${msg.type}`);
  });

  ws.on("close", () => {
    console.log(
      `[gateway] Client disconnected: ${state.user?.email || "unauthenticated"}`
    );
    if (state.user?.sub) {
      removeToken(state.user.sub);
    }
    if (state.ocConn) {
      state.ocConn.close();
    }
    clients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error("[gateway] WebSocket error:", err.message);
  });
});

// ── Helpers ──

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendError(ws, message) {
  send(ws, { type: "error", message });
}

// ── Start ──

httpServer.listen(PORT, () => {
  console.log(`
┌──────────────────────────────────────────────────┐
│  SecureGate WebSocket Gateway                    │
│                                                  │
│  Port:      ${PORT}                                │
│  Auth0:     ${AUTH0_DOMAIN}
│  OpenClaw:  ${OPENCLAW_WS_URL}     │
│                                                  │
│  WS:   ws://localhost:${PORT}                      │
│  HTTP: http://localhost:${PORT}/api/token (local)  │
│  HTTP: http://localhost:${PORT}/health             │
│                                                  │
│  Frontend ──WS──► Gateway ──WS──► OpenClaw       │
│  Agent Service ──HTTP──► Gateway /api/token       │
└──────────────────────────────────────────────────┘
`);
});
