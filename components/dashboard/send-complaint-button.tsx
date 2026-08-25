"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";

// Sends the formal complaint for a report that never had one, or repeats it on
// request.
//
// Filing normally does this by itself. What this covers is the backlog: every
// report filed before the municipal directory existed reached nobody, and from
// the officer's side looked identical to one that had been sent.

export function SendComplaintButton({
  issueId,
  officeName,
  address,
  alreadySent,
}: {
  issueId: string;
  /** Where it would go, resolved from the report's coordinates. */
  officeName: string | null;
  address: string | null;
  /** True when a complaint has gone out before, so this is a repeat. */
  alreadySent: boolean;
}) {
  const [sending, setSending] = useState(false);
  const router = useRouter();

  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/issues/${issueId}/municipal-complaint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A repeat is always deliberate — the server refuses a second send
        // unless it is asked for explicitly.
        body: JSON.stringify({ resend: alreadySent }),
      });
      // Parsed defensively and after the status check: a gateway error page is
      // not JSON, and parsing it first would throw before the officer is told
      // anything at all.
      const data: { error?: string; to?: string } = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error || "Could not send the complaint.");
        return;
      }
      toast.success(`Complaint sent to ${data.to}.`);
      router.refresh();
    } catch {
      toast.error("Could not reach JanReport. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (!address) {
    return (
      <p className="text-sm text-muted-foreground">
        No municipal office covers this location, so there is nowhere to send a
        complaint. Add one to the directory and it will send from then on.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={send} disabled={sending} variant={alreadySent ? "outline" : "default"}>
        <Send className="size-4" />
        {sending
          ? "Sending..."
          : alreadySent
            ? "Send again"
            : `Send complaint to ${officeName ?? address}`}
      </Button>
      <p className="text-xs text-muted-foreground">
        {alreadySent
          ? "Already sent once. A repeat reads as a duplicate at the other end, so only do this if the first never arrived."
          : `Goes to ${address} with the photo, the map link and the reference.`}
      </p>
    </div>
  );
}
