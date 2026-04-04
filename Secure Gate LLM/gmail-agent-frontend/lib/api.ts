import { getAccessToken } from "./auth";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL || "http://127.0.0.1:8001";

async function callWithToken<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  }
  return data as T;
}

// Phase A calls (auth checks, gmail profile)
export async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  return callWithToken<T>(BACKEND_URL, path, init);
}

// Phase B calls (agent tools — summarize, classify, query)
export async function agentCall<T>(path: string, init?: RequestInit): Promise<T> {
  return callWithToken<T>(AGENT_URL, path, init);
}

export type UserProfile = {
  sub: string;
  email?: string;
  scope?: string;
};

export type GmailProfile = {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
};

export type EmailItem = {
  id: string;
  threadId: string;
  snippet?: string;
  subject?: string;
  from_?: string;
};

export async function fetchUserProfile() {
  return apiCall<UserProfile>("/api/me");
}

export async function fetchGmailProfile() {
  return apiCall<GmailProfile>("/api/gmail/profile");
}

export async function fetchRecentEmails(count = 5) {
  return apiCall<{ messages: EmailItem[] }>(
    `/api/gmail/recent?max_results=${count}`
  );
}

export async function queryAgent(userId: string, message: string) {
  return agentCall<{ response: string }>("/api/openclaw/query", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, message }),
  });
}

export async function summarizeAgent(userId: string, query?: string) {
  return agentCall<{ summary: string; email_count: number }>(
    "/api/agent/summarize",
    {
      method: "POST",
      body: JSON.stringify({ user_id: userId, query }),
    }
  );
}
