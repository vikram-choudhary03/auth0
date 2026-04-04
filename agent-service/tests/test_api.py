"""API endpoint tests with mocked Phase A backend."""

import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from app.main import app
from app.models.schemas import EmailMeta, EmailContent
from tests.mock_data import MOCK_EMAILS, MOCK_EMAIL_BODIES


client = TestClient(app)


# ── Helpers ──

def _mock_email_metas(count=10):
    return [EmailMeta(**e) for e in MOCK_EMAILS[:count]]


def _mock_email_content(email_id):
    data = MOCK_EMAIL_BODIES.get(email_id, MOCK_EMAIL_BODIES["msg_001"])
    return EmailContent(**data)


# ── Health ──

def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["phase"] == "B"
    assert "ollama_model" in data


# ── List Emails ──

@patch("app.tools.gmail_tools.gmail_client.list_recent_emails", new_callable=AsyncMock)
def test_list_emails(mock_list):
    mock_list.return_value = _mock_email_metas(5)
    resp = client.get("/api/agent/emails", params={"user_id": "test", "count": 5})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 5
    assert data[0]["sender"] == "alice@example.com"
    assert data[0]["id"] == "msg_001"


@patch("app.tools.gmail_tools.gmail_client.list_recent_emails", new_callable=AsyncMock)
def test_list_emails_default_count(mock_list):
    mock_list.return_value = _mock_email_metas(5)
    resp = client.get("/api/agent/emails", params={"user_id": "test"})
    assert resp.status_code == 200


# ── Get Email Content ──

@patch("app.tools.gmail_tools.gmail_client.get_email_content", new_callable=AsyncMock)
def test_get_email(mock_get):
    mock_get.return_value = _mock_email_content("msg_001")
    resp = client.get("/api/agent/emails/msg_001", params={"user_id": "test"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "msg_001"
    assert "database connection pool" in data["body"]


# ── Summarize ──

@patch("app.tools.gmail_tools.ollama_service.summarize_emails")
@patch("app.tools.gmail_tools.gmail_client.list_recent_emails", new_callable=AsyncMock)
def test_summarize(mock_list, mock_summarize):
    mock_list.return_value = _mock_email_metas(5)
    mock_summarize.return_value = "- Urgent: server outage reported by Alice\n- Q2 planning Thursday 2pm"
    resp = client.post("/api/agent/summarize", json={"user_id": "test"})
    assert resp.status_code == 200
    data = resp.json()
    assert "summary" in data
    assert data["email_count"] == 5


@patch("app.tools.gmail_tools.ollama_service.summarize_emails")
@patch("app.tools.gmail_tools.gmail_client.list_recent_emails", new_callable=AsyncMock)
def test_summarize_with_query(mock_list, mock_summarize):
    mock_list.return_value = _mock_email_metas(5)
    mock_summarize.return_value = "Alice reported a production server outage with 502 errors."
    resp = client.post("/api/agent/summarize", json={"user_id": "test", "query": "What is urgent?"})
    assert resp.status_code == 200
    data = resp.json()
    assert "summary" in data


# ── Classify ──

@patch("app.tools.gmail_tools.ollama_service.classify_emails")
@patch("app.tools.gmail_tools.gmail_client.list_recent_emails", new_callable=AsyncMock)
def test_classify(mock_list, mock_classify):
    mock_list.return_value = _mock_email_metas(5)
    mock_classify.return_value = "| Email | Category |\n|---|---|\n| Server outage | urgent |"
    resp = client.post("/api/agent/classify", params={"user_id": "test"})
    assert resp.status_code == 200


# ── Draft Reply ──

@patch("app.tools.gmail_tools.ollama_service.draft_reply")
@patch("app.tools.gmail_tools.gmail_client.get_email_content", new_callable=AsyncMock)
def test_draft_reply(mock_get, mock_draft):
    mock_get.return_value = _mock_email_content("msg_001")
    mock_draft.return_value = "Hi Alice,\n\nI'm looking into the connection pool issue now. Will update in 30 min.\n\nBest"
    resp = client.post("/api/agent/draft", json={
        "user_id": "test",
        "email_id": "msg_001",
        "instruction": "Say I'm looking into it"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["email_id"] == "msg_001"
    assert "Re:" in data["subject"]
    assert "looking into" in data["draft_body"]


# ── Agent Query ──

@patch("app.tools.gmail_tools.ollama_service.agent_chat")
@patch("app.tools.gmail_tools.gmail_client.list_recent_emails", new_callable=AsyncMock)
def test_agent_query(mock_list, mock_chat):
    mock_list.return_value = _mock_email_metas(5)
    mock_chat.return_value = "You have 1 urgent email about a server outage from Alice."
    resp = client.post("/api/agent/query", json={
        "user_id": "test",
        "message": "Do I have anything urgent?"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "response" in data
    assert "urgent" in data["response"].lower()
