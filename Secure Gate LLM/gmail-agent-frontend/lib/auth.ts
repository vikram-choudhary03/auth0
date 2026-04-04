const AUTH0_DOMAIN = process.env.NEXT_PUBLIC_AUTH0_DOMAIN || "";
const AUTH0_CLIENT_ID = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID || "";
const AUTH0_AUDIENCE = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE || "";
const REDIRECT_URI =
  process.env.NEXT_PUBLIC_AUTH0_REDIRECT_URI || "http://localhost:3000/callback";
const GOOGLE_CONNECTION =
  process.env.NEXT_PUBLIC_AUTH0_GOOGLE_CONNECTION || "google-oauth2";

// PKCE helpers
async function generateCodeVerifier(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function login() {
  const codeVerifier = await generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();

  // Store for callback
  sessionStorage.setItem("pkce_code_verifier", codeVerifier);
  sessionStorage.setItem("pkce_state", state);

  const url = new URL(`https://${AUTH0_DOMAIN}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", AUTH0_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("audience", AUTH0_AUDIENCE);
  url.searchParams.set("scope", "openid profile email offline_access");
  url.searchParams.set("connection", GOOGLE_CONNECTION);
  url.searchParams.set(
    "connection_scope",
    "https://www.googleapis.com/auth/gmail.readonly"
  );
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);

  window.location.href = url.toString();
}

export async function handleCallback(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const savedState = sessionStorage.getItem("pkce_state");
  const codeVerifier = sessionStorage.getItem("pkce_code_verifier");

  if (!code || !codeVerifier) return false;
  if (state !== savedState) {
    console.error("State mismatch");
    return false;
  }

  // Exchange code for tokens
  const tokenUrl = `https://${AUTH0_DOMAIN}/oauth/token`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: AUTH0_CLIENT_ID,
      code_verifier: codeVerifier,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const data = await res.json();

  if (data.access_token) {
    localStorage.setItem("access_token", data.access_token);
  }
  if (data.id_token) {
    localStorage.setItem("id_token", data.id_token);
  }
  if (data.refresh_token) {
    localStorage.setItem("refresh_token", data.refresh_token);
  }

  // Cleanup
  sessionStorage.removeItem("pkce_code_verifier");
  sessionStorage.removeItem("pkce_state");

  return !!data.access_token;
}

export function logout() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("id_token");
  localStorage.removeItem("refresh_token");
  if (AUTH0_DOMAIN && AUTH0_CLIENT_ID) {
    const url = new URL(`https://${AUTH0_DOMAIN}/v2/logout`);
    url.searchParams.set("client_id", AUTH0_CLIENT_ID);
    url.searchParams.set("returnTo", window.location.origin);
    window.location.href = url.toString();
  }
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("access_token");
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}
