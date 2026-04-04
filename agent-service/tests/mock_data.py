"""Mock email data for testing without Phase A."""

MOCK_EMAILS = [
    {
        "id": "msg_001",
        "sender": "alice@example.com",
        "subject": "Urgent: Server outage in production",
        "snippet": "Hey team, we have a critical issue with the prod servers. Need immediate attention...",
        "date": "2026-04-03T09:15:00Z",
    },
    {
        "id": "msg_002",
        "sender": "bob@company.com",
        "subject": "Q2 Planning Meeting - Thursday",
        "snippet": "Hi all, reminder that our Q2 planning session is this Thursday at 2pm...",
        "date": "2026-04-03T08:30:00Z",
    },
    {
        "id": "msg_003",
        "sender": "newsletter@techdigest.io",
        "subject": "Your weekly tech roundup",
        "snippet": "This week in tech: AI breakthroughs, new framework releases, and more...",
        "date": "2026-04-02T18:00:00Z",
    },
    {
        "id": "msg_004",
        "sender": "manager@company.com",
        "subject": "Re: Performance review feedback",
        "snippet": "Thanks for submitting your self-review. I'd like to schedule a 1:1 to discuss...",
        "date": "2026-04-02T14:22:00Z",
    },
    {
        "id": "msg_005",
        "sender": "noreply@spam-offers.com",
        "subject": "You've won a FREE cruise!!!",
        "snippet": "Congratulations! You have been selected for an exclusive offer...",
        "date": "2026-04-01T10:00:00Z",
    },
]

MOCK_EMAIL_BODIES = {
    "msg_001": {
        "id": "msg_001",
        "sender": "alice@example.com",
        "subject": "Urgent: Server outage in production",
        "body": (
            "Hey team,\n\n"
            "We have a critical issue with the prod servers. The API gateway is returning "
            "502 errors for about 30% of requests. I've checked the logs and it looks like "
            "the database connection pool is exhausted.\n\n"
            "Can someone from the infra team look into this ASAP?\n\n"
            "Thanks,\nAlice"
        ),
        "date": "2026-04-03T09:15:00Z",
    },
    "msg_002": {
        "id": "msg_002",
        "sender": "bob@company.com",
        "subject": "Q2 Planning Meeting - Thursday",
        "body": (
            "Hi all,\n\n"
            "Reminder that our Q2 planning session is this Thursday at 2pm in Conference Room B. "
            "Please come prepared with your team's priorities and any blockers.\n\n"
            "Agenda:\n1. Q1 retrospective\n2. Q2 OKRs\n3. Resource allocation\n4. Open discussion\n\n"
            "Best,\nBob"
        ),
        "date": "2026-04-03T08:30:00Z",
    },
    "msg_003": {
        "id": "msg_003",
        "sender": "newsletter@techdigest.io",
        "subject": "Your weekly tech roundup",
        "body": (
            "This week in tech:\n\n"
            "- New AI model achieves SOTA on reasoning benchmarks\n"
            "- React 21 released with server components by default\n"
            "- Python 3.15 beta available\n\n"
            "Read more at techdigest.io"
        ),
        "date": "2026-04-02T18:00:00Z",
    },
}
