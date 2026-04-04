# Gmail Agent Skill for OpenClaw

This skill connects OpenClaw to the Gmail Agent Service (Phase B backend).

## Tools

| Tool | Description |
|------|-------------|
| `list_recent_emails` | Fetch recent inbox emails |
| `get_email_content` | Read full email by ID |
| `summarize_emails` | Summarize emails with optional query |
| `classify_emails` | Categorize as urgent/needs-reply/info/spam |
| `draft_reply` | Draft a reply (no auto-send) |
| `agent_query` | Free-form email Q&A |

## Prerequisites

- Agent service running on `localhost:8001`
- Ollama running on `localhost:11434` with models pulled
- Phase A backend running on `localhost:8000` (Auth0 + Gmail)
