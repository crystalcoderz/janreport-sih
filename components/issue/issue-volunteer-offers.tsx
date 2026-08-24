"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HeartHandshake, X } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/lib/supabase/types";

type OfferRow = Database["public"]["Tables"]["issue_volunteer_offers"]["Row"] & {
  offererName: string | null;
  groupName: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  offered: "Offered",
  accepted: "Accepted",
  completed: "Completed",
  withdrawn: "Withdrawn",
};

export function IssueVolunteerOffers({
  issueId,
  userId,
  myGroups,
  initialOffers,
}: {
  issueId: string;
  userId: string;
  myGroups: { id: string; name: string }[];
  initialOffers: OfferRow[];
}) {
  const [offers, setOffers] = useState<OfferRow[]>(initialOffers);
  const [groupId, setGroupId] = useState("self");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const myOffer = offers.find(
    (o) => o.offered_by === userId && o.status !== "withdrawn"
  );

  async function submit() {
    setSubmitting(true);
    try {
      const supabase = createClient();
      // Upsert, not insert. Withdrawing sets status to 'withdrawn' rather than
      // deleting the row, and myOffer above ignores withdrawn ones — so the
      // form correctly comes back, but the row is still there and a plain
      // insert hit `unique (issue_id, offered_by)` every single time. A
      // citizen who withdrew once could never offer again, and the error told
      // them they had already offered, which the UI was simultaneously
      // denying. Re-offering revives the same row.
      const { data, error } = await supabase
        .from("issue_volunteer_offers")
        .upsert(
          {
            issue_id: issueId,
            offered_by: userId,
            volunteer_group_id: groupId === "self" ? null : groupId,
            note: note.trim() || null,
            status: "offered",
          },
          { onConflict: "issue_id,offered_by" }
        )
        .select()
        .single();

      if (error || !data) {
        toast.error("Could not submit your offer. Please try again.");
        return;
      }
      const group = myGroups.find((g) => g.id === groupId);
      // Drop any previous copy of this row before prepending — reviving a
      // withdrawn offer returns the same id, and keeping both would render
      // duplicate React keys.
      setOffers((prev) => [
        { ...data, offererName: "You", groupName: group?.name ?? null },
        ...prev.filter((o) => o.id !== data.id),
      ]);
      setNote("");
      toast.success("Thanks — your offer to help has been posted.");
    } finally {
      setSubmitting(false);
    }
  }

  async function withdraw(offerId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("issue_volunteer_offers")
      .update({ status: "withdrawn" })
      .eq("id", offerId);
    if (error) {
      toast.error("Could not withdraw your offer.");
      return;
    }
    setOffers((prev) =>
      prev.map((o) => (o.id === offerId ? { ...o, status: "withdrawn" } : o))
    );
  }

  const visibleOffers = offers.filter((o) => o.status !== "withdrawn");

  return (
    <div className="flex flex-col gap-3">
      {visibleOffers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No one has offered to help yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleOffers.map((o) => (
            <div
              key={o.id}
              className="flex items-start justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">
                    {o.groupName ?? o.offererName ?? "A volunteer"}
                  </span>
                  <Badge variant="outline">{STATUS_LABELS[o.status]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(o.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                {o.note && <p className="mt-0.5 text-muted-foreground">{o.note}</p>}
              </div>
              {o.offered_by === userId && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => withdraw(o.id)}
                  aria-label="Withdraw offer"
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!myOffer && (
        <div className="flex flex-col gap-2">
          {myGroups.length > 0 && (
            <Select value={groupId} onValueChange={(v) => v && setGroupId(v)}>
              <SelectTrigger className="w-56">
                <SelectValue>
                  {(v) =>
                    v === "self"
                      ? "Offer as myself"
                      : (myGroups.find((g) => g.id === v)?.name ?? "Offer as myself")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="self">Offer as myself</SelectItem>
                {myGroups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Textarea
            placeholder="How can you help? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
          />
          <Button
            size="sm"
            className="self-start"
            disabled={submitting}
            onClick={submit}
          >
            <HeartHandshake className="size-4" />
            Offer to help
          </Button>
        </div>
      )}
    </div>
  );
}
