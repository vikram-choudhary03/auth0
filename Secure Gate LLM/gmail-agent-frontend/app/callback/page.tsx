"use client";

import { useEffect, useRef, useState } from "react";
import { handleCallback } from "@/lib/auth";
import { Mail } from "lucide-react";

export default function CallbackPage() {
  const [error, setError] = useState("");
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    async function process() {
      console.log("[Callback] Full URL:", window.location.href);

      const params = new URLSearchParams(window.location.search);
      const urlError = params.get("error_description") || params.get("error");
      if (urlError) {
        setError(urlError);
        return;
      }

      try {
        const success = await handleCallback();
        console.log("[Callback] Token exchange success:", success);
        if (success) {
          window.location.replace("/chat");
        } else {
          setError("Failed to process login. Please try again.");
        }
      } catch (err) {
        console.error("[Callback] Error:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }
    process();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 p-4">
        <p className="text-destructive text-sm text-center max-w-md">{error}</p>
        <a href="/" className="text-sm text-primary underline">
          Back to login
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <Mail className="w-8 h-8 text-primary animate-pulse" />
      <p className="text-muted-foreground">Signing you in...</p>
    </div>
  );
}
