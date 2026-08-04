"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle, X, Send, Sparkles, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
}

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Hi! I'm the JanReport help assistant — I can check the live status of your reports, look up any issue, or find what's been reported near you. What do you need?",
};

// Human-readable labels for the activity chips, so citizens see this
// actually looked something up rather than trusting a canned answer.
const TOOL_LABELS: Record<string, string> = {
  get_my_reports: "Checked your reports",
  get_issue_details: "Looked up issue details",
  find_nearby_issues: "Searched nearby issues",
  get_city_stats: "Pulled city-wide stats",
};

export function HelpChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/kimi/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next
            .filter((m) => m !== GREETING)
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error || "Something went wrong." },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, toolsUsed: data.toolsUsed },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network error. Please try again." },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <Button
        size="icon"
        className="fixed bottom-5 right-5 z-50 size-12 rounded-full shadow-lg"
        onClick={() => setOpen(true)}
        aria-label="Open help chat"
      >
        <MessageCircle className="size-5" />
      </Button>
    );
  }

  return (
    <div className="fixed inset-3 top-16 z-50 flex flex-col overflow-hidden rounded-lg border bg-background shadow-xl sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[28rem] sm:w-96">
      <div className="flex items-center justify-between border-b bg-secondary/50 px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" />
          JanReport Help
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => setOpen(false)}
          aria-label="Close help chat"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn("flex flex-col gap-1", m.role === "user" && "items-end")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground"
              )}
            >
              {m.content}
            </div>
            {m.toolsUsed && m.toolsUsed.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {[...new Set(m.toolsUsed)].map((tool) => (
                  <span
                    key={tool}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    <CheckCircle2 className="size-3 text-primary" />
                    {TOOL_LABELS[tool] ?? tool}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
            Thinking...
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t p-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask a question..."
          rows={1}
          className="min-h-9 resize-none"
        />
        <Button size="icon" onClick={send} disabled={sending || !input.trim()}>
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}
