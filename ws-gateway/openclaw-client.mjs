/**
 * OpenClaw WebSocket Protocol Client
 *
 * Implements the OpenClaw gateway protocol (v3) with device identity:
 *   1. Connect to ws://host:port
 *   2. Wait for connect.challenge event (nonce)
 *   3. Generate Ed25519 device identity + sign the connect payload
 *   4. Send connect request with token auth + device identity
 *   5. Wait for hello-ok (with operator.write scope)
 *   6. Send agent requests, receive responses
 */

import WebSocket from "ws";
import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = 3;
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEVICE_KEY_PATH = join(__dirname, ".device-keys.json");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// ── Device Identity (matches OpenClaw's device-identity.ts) ──

function base64UrlEncode(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem) {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 &&
      spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem) {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function getOrCreateDeviceKeys() {
  if (existsSync(DEVICE_KEY_PATH)) {
    try {
      const data = JSON.parse(readFileSync(DEVICE_KEY_PATH, "utf8"));
      if (data.publicKeyPem && data.privateKeyPem && data.deviceId) return data;
    } catch {}
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);

  const keys = { deviceId, publicKeyPem, privateKeyPem };
  writeFileSync(DEVICE_KEY_PATH, JSON.stringify(keys, null, 2));
  console.log("[device] Generated new device identity:", deviceId);
  return keys;
}

function signDevicePayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), key));
}

// ── Connection ──

export class OpenClawConnection {
  /** @param {{ url: string, token: string, onEvent?: (event: any) => void }} opts */
  constructor(opts) {
    this.url = opts.url;
    this.token = opts.token;
    this.onEvent = opts.onEvent || (() => {});
    this.deviceKeys = getOrCreateDeviceKeys();

    /** @type {WebSocket | null} */
    this.ws = null;
    this.connected = false;
    this.deviceToken = null; // Returned by gateway after pairing
    this.pendingRequests = new Map();
    this._connectPromise = null;
  }

  /** Open WebSocket and complete the challenge-connect handshake with device identity. */
  async connect() {
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      const timeout = setTimeout(() => {
        reject(new Error("OpenClaw connection timeout (30s)"));
        ws.close();
      }, 30_000);

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      ws.on("close", () => {
        this.connected = false;
        this._connectPromise = null;
        for (const [, req] of this.pendingRequests) {
          req.reject(new Error("Connection closed"));
        }
        this.pendingRequests.clear();
      });

      ws.on("message", (data) => {
        let frame;
        try {
          frame = JSON.parse(data.toString());
        } catch {
          return;
        }

        // Step 2: Handle challenge — sign and send connect with device identity
        if (frame.type === "event" && frame.event === "connect.challenge") {
          const nonce = frame.payload?.nonce;
          const signedAt = Date.now();

          const clientId = "gateway-client";
          const clientMode = "backend";
          const role = "operator";
          const platform = "linux";
          const scopes = [
            "operator.admin",
            "operator.write",
            "operator.read",
            "operator.approvals",
            "operator.pairing",
          ];

          // Build the V3 signature payload (pipe-delimited, matches OpenClaw's buildDeviceAuthPayloadV3)
          const sigPayload = [
            "v3",
            this.deviceKeys.deviceId,
            clientId,
            clientMode,
            role,
            scopes.join(","),
            String(signedAt),
            this.token,
            nonce,
            platform, // normalizeDeviceMetadataForAuth lowercases
            "",       // deviceFamily (empty)
          ].join("|");

          const signature = signDevicePayload(this.deviceKeys.privateKeyPem, sigPayload);
          const publicKeyB64Url = base64UrlEncode(derivePublicKeyRaw(this.deviceKeys.publicKeyPem));

          const connectReq = {
            type: "req",
            id: crypto.randomUUID(),
            method: "connect",
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: clientId,
                version: "1.0.0",
                platform,
                mode: clientMode,
              },
              auth: { token: this.token },
              role,
              scopes,
              device: {
                id: this.deviceKeys.deviceId,
                publicKey: publicKeyB64Url,
                signature,
                signedAt,
                nonce,
              },
            },
          };

          ws.send(JSON.stringify(connectReq));
          return;
        }

        // Step 4: Handle hello-ok
        if (
          frame.type === "res" &&
          frame.ok &&
          frame.payload?.type === "hello-ok"
        ) {
          // Save device token if returned (for future connections)
          if (frame.payload?.auth?.deviceToken) {
            this.deviceToken = frame.payload.auth.deviceToken;
          }
          this.connected = true;
          clearTimeout(timeout);
          console.log("[openclaw] Connected with device identity");
          resolve();
          return;
        }

        // Handle failed connect
        if (frame.type === "res" && !frame.ok && !this.connected) {
          clearTimeout(timeout);
          const errMsg =
            frame.error?.message || frame.payload?.error || "Connect failed";
          console.error("[openclaw] Connect failed:", errMsg);
          reject(new Error(errMsg));
          ws.close();
          return;
        }

        // Handle response frames for pending requests
        if (frame.type === "res" && frame.id) {
          const pending = this.pendingRequests.get(frame.id);
          if (pending) {
            if (!frame.ok) {
              this.pendingRequests.delete(frame.id);
              pending.reject(
                new Error(
                  frame.error?.message ||
                    frame.payload?.errorMessage ||
                    "Request failed"
                )
              );
              return;
            }

            // If expectFinal, ignore intermediate "accepted" responses
            if (pending.expectFinal) {
              const status = frame.payload?.status;
              if (status === "accepted" || status === "queued") {
                return;
              }
            }

            this.pendingRequests.delete(frame.id);
            pending.resolve(frame.payload);
            return;
          }
        }

        // Handle event frames
        if (frame.type === "event") {
          this.onEvent(frame);
        }
      });
    });

    return this._connectPromise;
  }

  /**
   * Send a request to OpenClaw and wait for the response.
   * @param {string} method
   * @param {object} params
   * @param {{ expectFinal?: boolean, timeoutMs?: number }} opts
   * @returns {Promise<any>}
   */
  async request(method, params, opts = {}) {
    if (!this.connected) {
      await this.connect();
    }

    const id = crypto.randomUUID();
    const timeoutMs = opts.timeoutMs || 120_000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request "${method}" timed out (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        expectFinal: opts.expectFinal ?? false,
      });

      this.ws.send(
        JSON.stringify({
          type: "req",
          id,
          method,
          params,
        })
      );
    });
  }

  /**
   * Send a message to the gmail-agent and get the response.
   * @param {string} message
   * @returns {Promise<{ text: string, meta: object }>}
   */
  async query(message) {
    const result = await this.request(
      "agent",
      {
        message,
        agentId: "gmail-agent",
        idempotencyKey: crypto.randomUUID(),
        channel: "webchat",
      },
      { expectFinal: true, timeoutMs: 120_000 }
    );

    // Extract text from payloads
    const payloads = result?.result?.payloads || [];
    const text = payloads.map((p) => p.text).filter(Boolean).join("\n") || "";
    const meta = result?.result?.meta || {};

    return { text, meta };
  }

  /** Close the connection. */
  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this._connectPromise = null;
  }
}
