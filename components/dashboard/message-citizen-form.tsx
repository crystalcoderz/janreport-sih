"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Writing to the citizen who filed a report, in the officer's own words.
//
// Everything else this system sends them is generated. None of it can say
// "the photo shows your own street, not the pothole" or ask which end of the
// lane they meant.

const MAX_CHARS = 900;

export function MessageCitizenForm({
  issueId,
  reporterName,
  hasPhone,
  hasEmail,
}: {
  issueId: string;
  /** Shown so the officer knows who they are writing to before they write. */
  reporterName: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const router = useRouter();

  const who = reporterName ?? "this citizen";

  async function send() {
    if (!message.trim()) {
      toast.error("Write a message first.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/issues/${issueId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data: {
        error?: string;
        delivered?: boolean;
        whatsapp?: string;
        whatsappError?: string | null;
        email?: string;
      } = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error || "Could not send the message.");
        return;
      }

      // Reported channel by channel rather than as a single "sent". WhatsApp
      // silently refuses free-form text outside a 24-hour window, and an
      // officer who is told "sent" would never know the citizen heard nothing.
      if (data.delivered) {
        const via = [
          data.whatsapp === "sent" ? "WhatsApp" : null,
          data.email === "sent" ? "email" : null,
        ]
          .filter(Boolean)
          .join(" and ");
        toast.success(`Message sent to ${who} on ${via}.`);
        setMessage("");
      } else {
        toast.error(
          data.whatsappError ??
            `Nothing could be delivered to ${who}. It has been recorded on the timeline.`
        );
      }
      router.refresh();
    } catch {
      toast.error("Could not reach JanReport. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (!hasPhone && !hasEmail) {
    return (
      <p className="text-sm text-muted-foreground">
        {reporterName ? `${reporterName} has` : "This citizen has"} no phone
        number or email address on file, so there is no way to reach them.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        To <span className="font-medium">{who}</span>
        <span className="text-muted-foreground">
          {" · "}
          {[hasPhone ? "WhatsApp" : null, hasEmail ? "email" : null]
            .filter(Boolean)
            .join(" + ")}
        </span>
      </p>

      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, MAX_CHARS))}
        placeholder="e.g. The photo shows the road outside your gate rather than the pothole — could you send another?"
        rows={4}
      />

      <div className="flex items-center gap-2">
        <Button onClick={send} disabled={sending || !message.trim()}>
          <MessageSquare className="size-4" />
          {sending ? "Sending..." : "Send message"}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {message.length}/{MAX_CHARS}
        </span>
      </div>

      {hasPhone && (
        <p className="text-xs text-muted-foreground">
          WhatsApp only accepts a free-form message within 24 hours of their
          last one. Outside that it is refused and you will be told so
          {hasEmail ? ", but the email still goes" : ""}.
        </p>
      )}
    </div>
  );
}
