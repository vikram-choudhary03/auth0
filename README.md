# Gmail Agent— Auth0 Authorized to Act Hackathon

> **An AI-powered Gmail agent where Auth0 Token Vault is the single secure layer between the agent and your data. The AI can read, summarize, and send emails — but never holds your Google credentials.**

## The Problem

AI agents need access to user data (emails, calendars, files) — but giving an LLM your OAuth tokens is a security disaster. If the server is compromised, every user's Google token is exposed. If the LLM leaks context, credentials are in the output.

## Our Solution

**SecureGate LLM** uses Auth0 Token Vault as a secure intermediary:

- The **AI agent never sees** Google credentials
- The **server never stores** Google tokens permanently  
- Auth0 Token Vault **fetches tokens on-demand** and manages refresh
- **Step-up authentication** prevents the agent from sending emails without explicit user confirmation
- A **WebSocket gateway** bridges the frontend and AI orchestrator with real-time streaming

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend (Next.js :3000)                    │
│              Auth0 PKCE Login + Chat UI + Permissions Panel      │
└──────┬──────────────────────────────────────┬────────────────────┘
       │ HTTP (Auth0 JWT)                      │ WebSocket (Auth0 JWT)
       ▼                                       ▼
┌──────────────────┐                ┌─────────────────────────────┐
│  Backend (:8000)  │                │  WS Gateway (:8002)         │
│                   │                │                             │
│  Auth0 JWT check  │                │  - Validates Auth0 JWT      │
│  Management API   │                │  - Stores token in memory   │
│  TOKEN VAULT      │                │  - Connects to OpenClaw     │
│  → Google token   │                │  - Streams responses        │
│  Gmail API calls  │                │    word-by-word to frontend │
│  Permissions API  │                │  - /api/token (localhost)   │
│  Send email       │                └──────────┬──────────────────┘
└──────┬────────────┘                           │ WebSocket (Ed25519
       ▲                                        │  device identity)
       │ HTTP + Bearer token                    ▼
       │                            ┌─────────────────────────────┐
       │                            │  OpenClaw (:18789)           │
       │                            │                             │
       │                            │  AI Orchestrator:           │
       │                            │  1. Groq/Llama 3.3 70B     │
       │                            │  2. Gemini 2.0 Flash        │
       │                            │  3. Ollama/Qwen3 8B (local) │
       │                            │                             │
       │                            │  Decides which tool to call  │
       │                            │  based on user's question    │
       │                            └──────────┬──────────────────┘
       │                                       │ exec: curl
       │                                       ▼
       │                            ┌─────────────────────────────┐
       │                            │  Agent Service (:8001)       │
       │                            │                             │
       │                            │  /api/agent/emails          │
       │                            │  /api/agent/summarize       │
       │                            │  /api/agent/classify        │
       │                            │  /api/agent/send            │
       │                            │  /api/agent/confirm-send    │
       │                            │                             │
       │                            │  Gets Auth0 JWT from        │
       │                            │  Gateway's /api/token       │
       └────────────────────────────┤  (LLM never sees the token) │
                                    └─────────────────────────────┘
```

---

## Auth0 Token Vault — How It Works

This is the core of our hackathon submission:

```
1. User clicks "Sign in with Google"
   → Auth0 handles the OAuth flow (PKCE)
   → Google grants gmail.readonly scope
   → Auth0 stores the Google token in TOKEN VAULT
   → Returns Auth0 JWT to the browser

2. User asks: "Show me my emails"
   → Frontend sends query via WebSocket
   → Gateway validates Auth0 JWT, stores it in memory
   → OpenClaw (AI) decides to fetch emails
   → Agent Service needs Gmail access
   → Agent Service fetches Auth0 JWT from Gateway's /api/token
   → Backend receives JWT, calls Auth0 Management API
   → Management API retrieves Google token from TOKEN VAULT
   → Backend calls Gmail API with Google token
   → Emails returned to user

3. At no point does:
   - The AI model see any tokens
   - The server permanently store Google credentials
   - The user share their Google password
```

### Why Token Vault matters for AI Agents

| Without Token Vault | With Token Vault |
|---|---|
| `.env` has Google tokens for every user | `.env` has only 1 Auth0 client secret |
| Server breach = access to ALL user data | Server breach = useless without Auth0 |
| You manage token refresh per service | Auth0 manages everything |
| LLM could leak tokens from context | LLM never sees tokens |

**One key to the vault, not a copy of every key inside it.**

---

## Security Model

### Permission Boundaries

| Action | Auth Level | Description |
|---|---|---|
| Read emails | Standard | Allowed with Auth0 JWT |
| Summarize emails | Standard | Local AI processing |
| Classify emails | Standard | Local AI processing |
| Draft reply | Standard | AI drafts, does NOT send |
| **Send email** | **Step-up** | **Requires explicit user confirmation** |
| Delete emails | Blocked | Not permitted |
| Modify labels | Blocked | Not permitted |

### Step-up Authentication for Send

The agent **cannot** send an email without a two-step confirmation enforced at the API level:

```
Step 1: Agent drafts email
   POST /api/agent/send (confirm=false)
   → Returns preview: "Draft: To: X, Subject: Y. Should I send?"
   → Draft stored in memory

Step 2: User explicitly confirms
   POST /api/agent/confirm-send
   → Only then does it actually send
   → The LLM cannot bypass this — enforced at the API, not the prompt
```

### Credential Isolation

```
┌─ What the LLM sees ──────────────────┐
│  User's query                         │
│  Email content (after fetching)       │
│  Tool instructions                    │
│  NEVER: JWT, Google token, API keys   │
└───────────────────────────────────────┘

┌─ Token lifecycle ────────────────────┐
│  User connects via WebSocket          │
│  → JWT stored in Gateway memory       │
│  User disconnects                     │
│  → JWT deleted from memory            │
│  Nothing persisted to disk            │
└───────────────────────────────────────┘
```

---

## User Control & Consent Visibility

The frontend includes a **Permissions Panel** that shows users:

- **Allowed actions** (standard auth): Read, summarize, classify, draft
- **Step-up actions** (requires confirmation): Send email
- **Blocked actions**: Delete, modify labels
- **Token Vault status**: Shows that Google credentials are stored in Auth0, not on the server
- **Scopes granted**: openid, profile, email, gmail.readonly

Users can see exactly what the agent can and cannot do at any time.

---

## Tech Stack

| Component | Technology | Purpose |
|---|---|---|
| Frontend | Next.js, Tailwind, shadcn/ui | Chat UI, Auth0 login, permissions panel |
| Backend | FastAPI (Python) | Auth0 JWT validation, Token Vault, Gmail API |
| Agent Service | FastAPI (Python) | Tool endpoints, 2-step send confirmation |
| WS Gateway | Node.js (ws, jose) | Auth bridge, token store, real-time streaming |
| AI Orchestrator | OpenClaw | Tool selection, model fallback chain |
| LLM (Primary) | Groq / Llama 3.3 70B | Fast cloud inference with tool calling |
| LLM (Fallback) | Google / Gemini 2.0 Flash | Secondary cloud model |
| LLM (Local) | Ollama / Qwen3 8B | Offline fallback |
| Auth | Auth0 (PKCE + Token Vault) | Identity, token management, consent |

---

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.10+
- Auth0 account with Token Vault enabled
- Groq API key (free at console.groq.com)
- Google AI API key (free at aistudio.google.com)
- (Optional) Ollama for local fallback

### 1. Clone and install

```bash
git clone https://github.com/vikram-choudhary03/auth0.git
cd auth0
```

### 2. Set up Auth0

1. Create an Auth0 application (SPA)
2. Enable Google social connection with `gmail.readonly` scope
3. Enable Token Vault for the Google connection
4. Create an API with identifier `gmail-agent`
5. Note your domain, client ID, and client secret

### 3. Configure environment

**Backend** (`Secure Gate LLM/.env`):
```
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=gmail-agent
AUTH0_CUSTOM_API_CLIENT_ID=your-client-id
AUTH0_CUSTOM_API_CLIENT_SECRET=your-client-secret
AUTH0_GOOGLE_CONNECTION=google-oauth2
FRONTEND_ORIGIN=http://localhost:3000
```

**Frontend** (`Secure Gate LLM/gmail-agent-frontend/.env.local`):
```
NEXT_PUBLIC_AUTH0_DOMAIN=your-tenant.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=your-spa-client-id
NEXT_PUBLIC_AUTH0_AUDIENCE=gmail-agent
NEXT_PUBLIC_AUTH0_REDIRECT_URI=http://localhost:3000/callback
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_AGENT_URL=http://localhost:8001
NEXT_PUBLIC_WS_GATEWAY_URL=ws://localhost:8002
```

**WS Gateway** (`ws-gateway/.env`):
```
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=gmail-agent
OPENCLAW_TOKEN=your-openclaw-gateway-token
OPENCLAW_WS_URL=ws://127.0.0.1:18789
WS_PORT=8002
```

**API Keys** (export in your shell):
```bash
export GROQ_API_KEY=your-groq-key
export GOOGLE_AI_API_KEY=your-google-ai-key
```

### 4. Start all services

```bash
# Terminal 1: OpenClaw Gateway
cd auth0
OPENCLAW_CONFIG_PATH=$(pwd)/openclaw.json npx openclaw gateway --force

# Terminal 2: Backend (Auth0 + Gmail)
cd "Secure Gate LLM"
uvicorn app:app --host 0.0.0.0 --port 8000 --reload

# Terminal 3: Agent Service
cd agent-service
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# Terminal 4: WebSocket Gateway
cd ws-gateway
node server.mjs

# Terminal 5: Frontend
cd "Secure Gate LLM/gmail-agent-frontend"
pnpm dev
```

### 5. Open the app

Visit `http://localhost:3000`, sign in with Google, and start chatting with your Gmail agent.

---

## Judging Criteria Checklist

### Security Model
- [x] Agent operates within explicit permission boundaries (read/summarize allowed, delete blocked)
- [x] Credentials protected via Auth0 Token Vault (Google tokens never on our server)
- [x] High-stakes actions (send email) protected by step-up authentication
- [x] Two-step confirmation enforced at API level, not just LLM prompt
- [x] LLM never sees Auth0 JWT or Google OAuth tokens

### User Control
- [x] Permissions panel shows what the agent can/cannot do
- [x] Scopes and access boundaries clearly defined (gmail.readonly)
- [x] Consent granted via Auth0's OAuth flow with explicit Google scope request
- [x] Users can see Token Vault status and security model

### Technical Execution
- [x] Token Vault integration: Management API → Token Vault → Google token on-demand
- [x] PKCE auth flow (most secure browser OAuth pattern)
- [x] Ed25519 device identity for OpenClaw gateway authentication
- [x] WebSocket streaming for real-time responses
- [x] Multi-model fallback chain (Groq → Gemini → Ollama)
- [x] Production-aware: env var secrets, .gitignore, no hardcoded credentials

### Design
- [x] Clean chat interface with markdown rendering
- [x] Permissions panel with clear security tiers (allowed/step-up/blocked)
- [x] Auth0 Token Vault status indicator
- [x] Real-time streaming (word-by-word response)
- [x] Balanced frontend + backend implementation

### Potential Impact
- [x] "Secure Gate" pattern: how to give AI agents API access without credential exposure
- [x] Demonstrates that Token Vault solves the "agent credential" problem at scale
- [x] Multi-model fallback shows practical production architecture

### Insight Value
- [x] Discovered OpenClaw's `"ollama-local"` reserved marker bug
- [x] Documented Ed25519 device identity requirement for write scope
- [x] Step-up auth pattern for high-stakes agent actions
- [x] Token store pattern: JWT in memory, deleted on disconnect, never persisted

---

## Project Structure

```
/
├── Secure Gate LLM/
│   ├── app.py                          # Backend: Auth0 + Token Vault + Gmail API
│   └── gmail-agent-frontend/           # Next.js frontend
│       ├── app/chat/page.tsx           # Chat UI with WS streaming
│       ├── lib/auth.ts                 # Auth0 PKCE login
│       ├── lib/api.ts                  # HTTP API client
│       └── lib/ws.ts                   # WebSocket gateway client
│
├── ws-gateway/
│   ├── server.mjs                      # Gateway: auth + token store + streaming
│   └── openclaw-client.mjs             # OpenClaw protocol v3 + Ed25519
│
├── agent-service/
│   └── app/
│       ├── main.py                     # FastAPI tool endpoints
│       ├── services/gmail_client.py    # Token resolution + Gmail
│       └── tools/gmail_tools.py        # Tools with 2-step send
│
├── openclaw.json                       # OpenClaw config (models, providers)
└── openclaw/
    ├── config/gateway.json             # Gateway config
    └── skills/gmail-agent/             # Skill definitions
```

---

## License

MIT

---

Built for the [Auth0 Authorized to Act Hackathon](https://auth0.devpost.com/) by Vikram Choudhary.
