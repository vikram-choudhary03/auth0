/**
 * SecureGate WebSocket Gateway
 *
 * Sits between the frontend and OpenClaw:
 *   Frontend (Auth0 JWT) ──WS──► This Gateway ──WS──► OpenClaw (:18789)
 *
 * - Validates Auth0 JWTs using JWKS
 * - Creates per-user OpenClaw connections
 * - Forwards queries and streams responses
 */

import "dotenv/config";
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

/**
 * Validate an Auth0 JWT and return the payload.
 * @param {string} token
 * @returns {Promise<{ sub: string, email?: string }>}
 */
async function validateAuth0Token(token) {
  const { payload } = await jwtVerify(token, jwks, {
    audience: AUTH0_AUDIENCE,
    issuer: `https://${AUTH0_DOMAIN}/`,
    algorithms: ["RS256"],
  });
  return payload;
}

// ── Gateway Server ──

const wss = new WebSocketServer({ port: PORT });

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

        // Create OpenClaw connection for this user
        state.ocConn = new OpenClawConnection({
          url: OPENCLAW_WS_URL,
          token: OPENCLAW_TOKEN,
          onEvent: (event) => {
            // Forward OpenClaw events to frontend
            send(ws, { type: "event", event });
          },
        });

        await state.ocConn.connect();

        send(ws, {
          type: "authenticated",
          email: payload.email || payload.sub,
        });
        console.log(`[gateway] Authenticated: ${payload.email || payload.sub}`);
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

// ── Startup ──

console.log(`
┌─────────────────────────────────────────────┐
│  SecureGate WebSocket Gateway               │
│                                             │
│  Port:     ${PORT}                            │
│  Auth0:    ${AUTH0_DOMAIN}
│  OpenClaw: ${OPENCLAW_WS_URL}  │
│                                             │
│  Frontend ──WS──► Gateway ──WS──► OpenClaw  │
└─────────────────────────────────────────────┘
`);
