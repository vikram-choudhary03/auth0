"""Tests for Ollama service — tests actual Ollama integration with qwen3:8b.
These tests call the real Ollama instance, so they require Ollama to be running.
Mark with pytest.mark.integration to skip in CI.
"""

import pytest
from app.services.ollama_service import summarize_emails, classify_emails, draft_reply, agent_chat
from tests.mock_data import MOCK_EMAILS, MOCK_EMAIL_BODIES


def _emails_as_text():
    lines = []
    for e in MOCK_EMAILS:
        lines.append(f"- [{e['date']}] From: {e['sender']} | Subject: {e['subject']}\n  {e['snippet']}")
    return "\n".join(lines)


@pytest.mark.integration
def test_summarize_emails():
    result = summarize_emails(_emails_as_text())
    assert isinstance(result, str)
    assert len(result) > 20


@pytest.mark.integration
def test_summarize_emails_with_query():
    result = summarize_emails(_emails_as_text(), query="What is urgent?")
    assert isinstance(result, str)
    assert len(result) > 10


@pytest.mark.integration
def test_classify_emails():
    result = classify_emails(_emails_as_text())
    assert isinstance(result, str)
    assert len(result) > 10


@pytest.mark.integration
def test_draft_reply():
    email = MOCK_EMAIL_BODIES["msg_001"]
    result = draft_reply(email["body"], email["subject"], "Say I'm investigating the issue")
    assert isinstance(result, str)
    assert len(result) > 10


@pytest.mark.integration
def test_agent_chat():
    result = agent_chat("What needs my attention?", context=_emails_as_text())
    assert isinstance(result, str)
    assert len(result) > 10
