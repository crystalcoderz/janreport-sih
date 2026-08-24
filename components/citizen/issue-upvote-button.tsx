"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ThumbsUp } from "lucide-react";
import { toast } from "sonner";

export function IssueUpvoteButton({
  issueId,
  initialUpvoted,
  initialCount,
}: {
  issueId: string;
  initialUpvoted: boolean;
  initialCount: number;
}) {
  const [upvoted, setUpvoted] = useState(initialUpvoted);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    const method = upvoted ? "DELETE" : "POST";
    // finally, not a bare call: fetch rejects outright on a dropped
    // connection, and without this the button stayed disabled for the rest of
    // the page's life with nothing said.
    try {
      const res = await fetch(`/api/issues/${issueId}/upvote`, { method });
      if (!res.ok) {
        toast.error("Could not update your upvote. Please try again.");
        return;
      }
      setUpvoted(!upvoted);
      setCount((c) => c + (upvoted ? -1 : 1));
    } catch {
      toast.error("Could not reach JanReport. Check your connection.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant={upvoted ? "secondary" : "outline"}
      disabled={pending}
      onClick={toggle}
    >
      <ThumbsUp className="size-4" />
      {upvoted ? "Upvoted" : "Upvote"} ({count})
    </Button>
  );
}
