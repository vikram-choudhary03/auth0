# Gmail Agent — Authorized to Act Hackathon

A secure Gmail agent for OpenClaw that uses **Auth0 Token Vault** for delegated access, **Ollama** for local inference, and **OpenClaw** in restricted mode for orchestration.

## Architecture

```
User → OpenClaw (restricted) → Agent Service (FastAPI) → Ollama (local LLM)
                                       ↓
                                Phase A Backend → Auth0 Token Vault → Gmail API
```

- **OpenClaw**: orchestrator — calls agent tools, never owns credentials
- **Agent Service**: intermediary — exposes tools, talks to Ollama + Phase A
- **Ollama**: local inference — summarization, classification, drafting
- **Auth0 Token Vault**: handles OAuth tokens for Gmail (Phase A)

## Phase B Setup (OpenClaw + Ollama + Agent)

### 1. Install Ollama and pull models

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull models
ollama pull qwen3:8b
ollama pull qwen2.5-coder:14b
```

### 2. Start the Agent Service

```bash
cd agent-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp ../.env.example .env   # edit as needed

python -m app.main
# Runs on http://localhost:8001
```

### 3. Install and configure OpenClaw

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

Copy `openclaw/config/gateway.json` to your OpenClaw config directory. Install the gmail-agent skill from `openclaw/skills/gmail-agent/`.

### 4. Start OpenClaw Gateway

```bash
openclaw gateway --port 18789 --verbose
```

### 5. Test the agent

```bash
# Health check
curl http://localhost:8001/health

# List emails (needs Phase A running)
curl "http://localhost:8001/api/agent/emails?user_id=test"

# Summarize
curl -X POST http://localhost:8001/api/agent/summarize \
  -H "Content-Type: application/json" \
  -d '{"user_id": "test", "query": "What needs my attention today?"}'

# Free-form query
curl -X POST http://localhost:8001/api/agent/query \
  -H "Content-Type: application/json" \
  -d '{"user_id": "test", "message": "Summarize my last 10 emails"}'
```

## Agent Tools

| Tool | Description |
|------|-------------|
| `list_recent_emails` | Fetch recent inbox metadata |
| `get_email_content` | Read full email by ID |
| `summarize_emails` | AI-powered email summary with optional query |
| `classify_emails` | Categorize: urgent / needs-reply / info / spam |
| `draft_reply` | Draft a reply (no auto-send in V1) |
| `agent_query` | Free-form email Q&A |

## Tech Stack

- **OpenClaw** — agent orchestration (restricted mode)
- **Ollama** — local LLM inference (qwen3:8b, qwen2.5-coder:14b)
- **FastAPI** — agent service backend
- **Auth0 Token Vault** — delegated OAuth for Gmail (Phase A)
