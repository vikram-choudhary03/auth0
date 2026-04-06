/**
 * WebSocket client for the SecureGate Gateway.
 */

import { getAccessToken } from "./auth";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_GATEWAY_URL || "ws://localhost:8002";

export type GatewayMessage =
  | { type: "authenticated"; email: string }
  | { type: "auth_error"; message: string }
  | { type: "status"; status: string }
  | { type: "delta"; delta: string; fullText: string }
  | { type: "response"; text: string; meta?: Record<string, unknown> }
  | { type: "error"; message: string }
  | { type: "event"; event: unknown };

type MessageHandler = (msg: GatewayMessage) => void;

// Module-level state — survives React strict mode re-renders
let _ws: WebSocket | null = null;
let _authenticated = false;
let _connecting = false;
let _handlers: Set<MessageHandler> = new Set();

function emit(msg: GatewayMessage) {
  for (const handler of _handlers) {
    try {
      handler(msg);
    } catch (err) {
      console.error("[ws] handler error:", err);
    }
  }
}

export function onGatewayMessage(handler: MessageHandler): () => void {
  _handlers.add(handler);
  return () => _handlers.delete(handler);
}

export async function connectGateway(): Promise<boolean> {
  // Already connected
  if (_ws && _authenticated && _ws.readyState === WebSocket.OPEN) {
    console.log("[ws] Already connected");
    return true;
  }

  // Already connecting
  if (_connecting) {
    console.log("[ws] Connection already in progress");
    return false;
  }

  const token = getAccessToken();
  if (!token) {
    console.error("[ws] No access token available");
    return false;
  }

  _connecting = true;
  console.log("[ws] Connecting to gateway:", WS_URL);

  return new Promise<boolean>((resolve) => {
    try {
      const ws = new WebSocket(WS_URL);

      const timeout = setTimeout(() => {
        console.error("[ws] Connection timeout");
        ws.close();
        _connecting = false;
        resolve(false);
      }, 10_000);

      ws.onopen = () => {
        console.log("[ws] WebSocket open, sending auth...");
        ws.send(JSON.stringify({ type: "auth", token }));
      };

      ws.onmessage = (event) => {
        let msg: GatewayMessage;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }

        if (msg.type === "authenticated") {
          _ws = ws;
          _authenticated = true;
          _connecting = false;
          clearTimeout(timeout);
          console.log("[ws] Gateway authenticated!", msg.email);
          resolve(true);
        } else if (msg.type === "auth_error") {
          clearTimeout(timeout);
          _connecting = false;
          console.error("[ws] Auth failed:", msg.message);
          ws.close();
          resolve(false);
        }

        // Forward all messages to handlers
        emit(msg);
      };

      ws.onclose = () => {
        console.log("[ws] Connection closed");
        _ws = null;
        _authenticated = false;
        _connecting = false;
      };

      ws.onerror = (err) => {
        console.error("[ws] WebSocket error:", err);
        clearTimeout(timeout);
        _connecting = false;
        resolve(false);
      };
    } catch (err) {
      console.error("[ws] Failed to create WebSocket:", err);
      _connecting = false;
      resolve(false);
    }
  });
}

export function sendQuery(message: string): boolean {
  if (!_ws || !_authenticated || _ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  _ws.send(JSON.stringify({ type: "query", message }));
  return true;
}

export function isGatewayConnected(): boolean {
  return _authenticated && _ws?.readyState === WebSocket.OPEN;
}

export function disconnectGateway(): void {
  if (_ws) {
    _ws.close();
    _ws = null;
  }
  _authenticated = false;
  _connecting = false;
}
