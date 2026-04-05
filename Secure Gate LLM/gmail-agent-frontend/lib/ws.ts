/**
 * WebSocket client for the SecureGate Gateway.
 *
 * Protocol:
 *   Client → Gateway:
 *     { type: "auth", token: "<Auth0 JWT>" }
 *     { type: "query", message: "..." }
 *
 *   Gateway → Client:
 *     { type: "authenticated", email: "..." }
 *     { type: "auth_error", message: "..." }
 *     { type: "status", status: "thinking" }
 *     { type: "response", text: "...", meta: {...} }
 *     { type: "error", message: "..." }
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

export class GatewayClient {
  private ws: WebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private authenticated = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connectPromise: Promise<void> | null = null;

  /** Subscribe to messages from the gateway. Returns an unsubscribe function. */
  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Connect and authenticate with the gateway. */
  async connect(): Promise<void> {
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise<void>((resolve, reject) => {
      const token = getAccessToken();
      if (!token) {
        reject(new Error("No access token"));
        return;
      }

      const ws = new WebSocket(WS_URL);
      this.ws = ws;

      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
        ws.close();
      }, 15_000);

      ws.onopen = () => {
        // Send auth as first message
        ws.send(JSON.stringify({ type: "auth", token }));
      };

      ws.onmessage = (event) => {
        let msg: GatewayMessage;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }

        // Handle auth response
        if (msg.type === "authenticated") {
          this.authenticated = true;
          clearTimeout(timeout);
          resolve();
        }

        if (msg.type === "auth_error") {
          clearTimeout(timeout);
          reject(new Error(msg.message));
          ws.close();
          return;
        }

        // Notify all handlers
        this.emit(msg);
      };

      ws.onclose = () => {
        this.authenticated = false;
        this.ws = null;
        this._connectPromise = null;
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket connection failed"));
      };
    });

    return this._connectPromise;
  }

  /** Send a query to the agent. */
  async send(message: string): Promise<void> {
    if (!this.ws || !this.authenticated) {
      await this.connect();
    }
    this.ws?.send(JSON.stringify({ type: "query", message }));
  }

  /** Disconnect from the gateway. */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.authenticated = false;
    this._connectPromise = null;
  }

  get isConnected(): boolean {
    return this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  private emit(msg: GatewayMessage) {
    for (const handler of this.handlers) {
      try {
        handler(msg);
      } catch (err) {
        console.error("[ws] handler error:", err);
      }
    }
  }
}

// Singleton instance
let _client: GatewayClient | null = null;

export function getGatewayClient(): GatewayClient {
  if (!_client) {
    _client = new GatewayClient();
  }
  return _client;
}
