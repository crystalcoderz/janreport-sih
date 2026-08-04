"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import type { Database } from "@/lib/supabase/types";

type CommentRow = Database["public"]["Tables"]["issue_comments"]["Row"] & {
  authorName: string | null;
};

export function IssueComments({
  issueId,
  userId,
  userFullName,
  initialComments,
}: {
  issueId: string;
  userId: string;
  userFullName: string | null;
  initialComments: CommentRow[];
}) {
  const [comments, setComments] = useState<CommentRow[]>(initialComments);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    // Unique per effect invocation — see use-issue-notifications.ts for why
    // (Strict Mode dev double-invoke + supabase-js channel topic reuse).
    const channel = supabase
      .channel(`issue-comments-${issueId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "issue_comments",
          filter: `issue_id=eq.${issueId}`,
        },
        async (payload) => {
          const row = payload.new as Database["public"]["Tables"]["issue_comments"]["Row"];
          setComments((prev) => {
            if (prev.some((c) => c.id === row.id)) return prev;
            return [...prev, { ...row, authorName: null }];
          });

          if (row.author_id === userId) return;
          const { data: author } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", row.author_id)
            .single();
          setComments((prev) =>
            prev.map((c) =>
              c.id === row.id ? { ...c, authorName: author?.full_name ?? null } : c
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "issue_comments" },
        (payload) => {
          const old = payload.old as { id: string };
          setComments((prev) => prev.filter((c) => c.id !== old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [issueId, userId]);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSubmitting(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("issue_comments")
      .insert({ issue_id: issueId, author_id: userId, body: trimmed })
      .select()
      .single();
    setSubmitting(false);

    if (error || !data) {
      toast.error("Could not post your comment. Please try again.");
      return;
    }
    setComments((prev) =>
      prev.some((c) => c.id === data.id)
        ? prev
        : [...prev, { ...data, authorName: userFullName }]
    );
    setBody("");
  }

  async function remove(id: string) {
    const previous = comments;
    setComments((prev) => prev.filter((c) => c.id !== id));
    const supabase = createClient();
    const { error } = await supabase.from("issue_comments").delete().eq("id", id);
    if (error) {
      toast.error("Could not delete comment.");
      setComments(previous);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3">
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No comments yet — be the first to share an update.
          </p>
        ) : (
          comments.map((c) => (
            <div
              key={c.id}
              className="flex items-start justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {c.authorName ?? "A citizen"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(c.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
              </div>
              {c.author_id === userId && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(c.id)}
                  aria-label="Delete comment"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Textarea
          placeholder="Add an update or question about this issue..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={1000}
        />
        <Button
          size="sm"
          className="self-end"
          disabled={submitting || !body.trim()}
          onClick={submit}
        >
          Post comment
        </Button>
      </div>
    </div>
  );
}
