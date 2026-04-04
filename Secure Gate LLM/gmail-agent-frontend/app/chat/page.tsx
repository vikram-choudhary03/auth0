"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { isAuthenticated, logout } from "@/lib/auth";
import {
  fetchUserProfile,
  fetchGmailProfile,
  fetchRecentEmails,
  queryAgent,
  type UserProfile,
  type GmailProfile,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Mail,
  Send,
  LogOut,
  Bot,
  User,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
};

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [gmail, setGmail] = useState<GmailProfile | null>(null);
  const [gmailVerified, setGmailVerified] = useState<
    "pending" | "success" | "error"
  >("pending");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/");
      return;
    }
    verifyConnection();
  }, [router]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function verifyConnection() {
    addMessage(
      "system",
      "Verifying your connection..."
    );

    try {
      const profile = await fetchUserProfile();
      setUser(profile);
      console.log("[Auth0] User profile:", profile);
      addMessage("system", `Authenticated as ${profile.email || profile.sub}`);
    } catch (err) {
      console.error("[Auth0] User profile error:", err);
      addMessage("system", "Failed to verify Auth0 token. Try signing in again.");
      setGmailVerified("error");
      return;
    }

    try {
      const gmailData = await fetchGmailProfile();
      setGmail(gmailData);
      setGmailVerified("success");
      console.log("[Gmail] Profile:", gmailData);
      addMessage(
        "system",
        `Gmail connected: ${gmailData.emailAddress} (${gmailData.messagesTotal?.toLocaleString()} messages)`
      );

      const emailData = await fetchRecentEmails(5);
      console.log("[Gmail] Recent emails:", emailData.messages);
      addMessage(
        "system",
        `Loaded ${emailData.messages.length} recent emails. You can now ask me about your inbox.`
      );
    } catch (err) {
      console.error("[Gmail] Access error:", err);
      setGmailVerified("error");
      addMessage(
        "system",
        "Gmail access not available yet. Make sure Token Vault is configured in Auth0."
      );
    }
  }

  function addMessage(role: Message["role"], content: string) {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role,
        content,
        timestamp: new Date(),
      },
    ]);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    addMessage("user", text);
    setLoading(true);

    try {
      const data = await queryAgent(user?.sub || "", text);
      addMessage("assistant", data.response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      addMessage("assistant", `Error: ${msg}`);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Gmail Agent</h1>
            <p className="text-xs text-muted-foreground">
              {user?.email || "Loading..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            {gmailVerified === "pending" && (
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            )}
            {gmailVerified === "success" && (
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            )}
            {gmailVerified === "error" && (
              <AlertCircle className="w-3 h-3 text-destructive" />
            )}
            <span className="text-muted-foreground">
              {gmailVerified === "success"
                ? gmail?.emailAddress
                : gmailVerified === "error"
                ? "Gmail not connected"
                : "Verifying..."}
            </span>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <Button variant="ghost" size="sm" onClick={logout} className="gap-2">
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </Button>
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4" ref={scrollRef}>
        <div className="max-w-3xl mx-auto py-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Bot className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-lg font-semibold">Welcome to Gmail Agent</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Ask me anything about your emails. I can summarize, classify,
                search, and draft replies.
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {msg.role !== "user" && (
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    msg.role === "system"
                      ? "bg-muted"
                      : "bg-primary/10"
                  }`}
                >
                  {msg.role === "system" ? (
                    <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                  ) : (
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  )}
                </div>
              )}

              <Card
                className={`px-4 py-2.5 max-w-[80%] ${
                  msg.role === "user"
                    ? "bg-secondary text-secondary-foreground"
                    : msg.role === "system"
                    ? "bg-muted/50 border-dashed"
                    : "bg-card"
                }`}
              >
                <div className="text-sm leading-relaxed prose prose-sm prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>li]:my-0.5 [&_a]:text-inherit [&_a]:no-underline [&_strong]:text-inherit [&_strong]:font-semibold [&_h1]:text-inherit [&_h2]:text-inherit [&_h3]:text-inherit [&_em]:text-inherit">
                  {msg.role === "user" ? (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  )}
                </div>
                <p
                  className={`text-[10px] mt-1 ${
                    msg.role === "user"
                      ? "text-muted-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {msg.timestamp.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </Card>

              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-secondary-foreground" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-3.5 h-3.5 text-primary" />
              </div>
              <Card className="px-4 py-3 bg-card">
                <div className="flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
                </div>
              </Card>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t px-4 py-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your emails..."
            disabled={loading}
            className="h-11"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            size="icon"
            className="h-11 w-11 shrink-0"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
