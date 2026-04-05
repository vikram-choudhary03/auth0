"""
Phase B Agent Service — exposes Gmail agent tools as HTTP endpoints.
OpenClaw calls these as skills. Can also be used directly.
"""

from typing import Optional

from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.models.schemas import AgentQuery, DraftRequest, SendEmailRequest, SummaryRequest
from app.tools import gmail_tools

app = FastAPI(
    title="Gmail Agent Service (Phase B)",
    description="OpenClaw-compatible agent tools: summarize, classify, draft, query emails via Ollama",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _extract_token(authorization: Optional[str]) -> str:
    """Extract Bearer token from Authorization header."""
    if authorization and authorization.startswith("Bearer "):
        return authorization.split(" ", 1)[1].strip()
    return ""


@app.get("/health")
async def health():
    return {"status": "ok", "phase": "B", "ollama_model": settings.ollama_summarize_model}


# ── Agent tool endpoints (called by OpenClaw skills or frontend) ──


@app.get("/api/agent/emails")
async def list_emails(user_id: str, count: int = 10, authorization: Optional[str] = Header(default=None)):
    token = _extract_token(authorization)
    return await gmail_tools.list_recent_emails(user_id, count, auth_token=token)


@app.get("/api/agent/emails/{email_id}")
async def get_email(user_id: str, email_id: str, authorization: Optional[str] = Header(default=None)):
    token = _extract_token(authorization)
    return await gmail_tools.get_email_content(user_id, email_id, auth_token=token)


@app.post("/api/agent/summarize")
async def summarize(req: SummaryRequest, authorization: Optional[str] = Header(default=None)):
    token = _extract_token(authorization)
    result = await gmail_tools.summarize_emails(req.user_id, req.query, auth_token=token)
    return result.model_dump()


@app.post("/api/agent/classify")
async def classify(user_id: str, authorization: Optional[str] = Header(default=None)):
    token = _extract_token(authorization)
    return {"classification": await gmail_tools.classify_emails(user_id, auth_token=token)}


@app.post("/api/agent/draft")
async def draft(req: DraftRequest, authorization: Optional[str] = Header(default=None)):
    token = _extract_token(authorization)
    result = await gmail_tools.draft_reply(req.user_id, req.email_id, req.instruction, auth_token=token)
    return result.model_dump()


@app.post("/api/agent/query")
async def query(req: AgentQuery, authorization: Optional[str] = Header(default=None)):
    token = _extract_token(authorization)
    answer = await gmail_tools.agent_query(req.user_id, req.message, auth_token=token)
    return {"response": answer}


@app.post("/api/agent/send")
async def send_email(req: SendEmailRequest, authorization: Optional[str] = Header(default=None)):
    """Send email — requires confirm=True (step-up auth).
    The agent can draft but NOT send without explicit user confirmation."""
    token = _extract_token(authorization)
    result = await gmail_tools.send_email(
        req.user_id, req.to, req.subject, req.body, req.confirm, auth_token=token
    )
    return result


class ConfirmSendRequest(BaseModel):
    user_id: str = "default"


@app.post("/api/agent/confirm-send")
async def confirm_send(req: ConfirmSendRequest = ConfirmSendRequest(), authorization: Optional[str] = Header(default=None)):
    """Confirm and send the most recently drafted email. Simple endpoint the LLM can call."""
    token = _extract_token(authorization)
    result = await gmail_tools.confirm_latest_send(req.user_id, auth_token=token)
    return result


# ── OpenClaw proxy — routes queries through OpenClaw gateway ──


@app.post("/api/openclaw/query")
async def openclaw_query(req: AgentQuery, authorization: Optional[str] = Header(default=None)):
    """Route query through OpenClaw gateway for intelligent tool selection."""
    import asyncio
    import json

    cmd = [
        "npx", "openclaw", "agent",
        "--agent", "gmail-agent",
        "--message", req.message,
        "--json",
    ]

    env = {
        "OPENCLAW_CONFIG_PATH": "/data/hackathon/openclaw.json",
        "PATH": "/home/wexa/.nvm/versions/node/v24.14.0/bin:/usr/local/bin:/usr/bin:/bin",
        "HOME": "/home/wexa",
    }

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd="/data/hackathon",
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)

        output = stdout.decode("utf-8", errors="replace").strip()
        err_output = stderr.decode("utf-8", errors="replace").strip()

        # Try to parse JSON response
        try:
            data = json.loads(output)
            # OpenClaw returns: { result: { payloads: [{ text: "..." }] } }
            result = data.get("result", {})
            payloads = result.get("payloads", [])
            if payloads:
                response_text = payloads[0].get("text", "")
            else:
                response_text = result.get("text", "") or data.get("text", "") or output
        except json.JSONDecodeError:
            # If not JSON, use raw output
            response_text = output or err_output or "No response from OpenClaw"

        return {"response": response_text, "via": "openclaw"}

    except asyncio.TimeoutError:
        return {"response": "OpenClaw request timed out (120s)", "via": "openclaw", "error": True}
    except Exception as e:
        return {"response": f"OpenClaw error: {str(e)}", "via": "openclaw", "error": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.agent_port, reload=True)
