"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IssueStatus } from "@/lib/supabase/types";
import { toast } from "sonner";
import { downscaleImage } from "@/lib/image-resize";
import { Sparkles } from "lucide-react";
import { selectableStatuses } from "@/lib/issue-status";

const STATUS_LABELS: Record<IssueStatus, string> = {
  reported: "Reported",
  acknowledged: "Acknowledged",
  in_progress: "In Progress",
  resolved: "Resolved",
  rejected: "Rejected",
};

export function StatusUpdateForm({
  issueId,
  currentStatus,
}: {
  issueId: string;
  currentStatus: IssueStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<IssueStatus>(currentStatus);
  const [note, setNote] = useState("");
  const [resolutionPhoto, setResolutionPhoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [drafting, setDrafting] = useState(false);

  async function handleDraftNote() {
    setDrafting(true);
    try {
      const res = await fetch("/api/kimi/draft-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, targetStatus: status }),
      });
      const data = await res.json().catch(() => ({}) as { error?: string; note?: string });
      if (!res.ok) {
        toast.error(data.error || "Could not draft a note");
        return;
      }
      setNote(data.note ?? "");
    } catch {
      toast.error("Could not reach JanReport. Check your connection and try again.");
    } finally {
      setDrafting(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      let resolutionPhotoUrl: string | undefined;

      if (status === "resolved" && resolutionPhoto) {
        const fd = new FormData();
        fd.set("photo", resolutionPhoto);
        fd.set("issueId", issueId);
        const uploadRes = await fetch("/api/uploads/resolution-photo", {
          method: "POST",
          body: fd,
        });
        // Parsed defensively and after the status check: a raw camera JPEG can
        // exceed the platform's request-body limit, and the 413 that comes
        // back is an HTML error page, not JSON. Parsing it first threw before
        // the officer was ever told the upload failed.
        const uploadData = await uploadRes
          .json()
          .catch(() => ({}) as { error?: string; publicUrl?: string });
        if (!uploadRes.ok) {
          toast.error(uploadData.error || "Failed to upload resolution photo");
          return;
        }
        resolutionPhotoUrl = uploadData.publicUrl;
      }

      const res = await fetch(`/api/issues/${issueId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: note || undefined, resolutionPhotoUrl }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to update status");
        return;
      }

      toast.success("Status updated");
      setNote("");
      setResolutionPhoto(null);
      router.refresh();
    } catch {
      toast.error("Could not update the status. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Status</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as IssueStatus)}>
          <SelectTrigger>
            <SelectValue>{(v) => STATUS_LABELS[v as IssueStatus] ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {/* Only moves the API will accept, plus the current status so an
                officer can leave it alone and just add a note. Offering the
                full list meant the commonest action answered 409 -- after the
                browser had already uploaded the proof photo. */}
            {selectableStatuses(currentStatus).map((value) => (
              <SelectItem key={value} value={value}>
                {STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="note">Note (optional)</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleDraftNote}
            disabled={drafting}
          >
            <Sparkles className="size-3.5" />
            {drafting ? "Drafting..." : "Draft with AI"}
          </Button>
        </div>
        <Textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What was done / why this status?"
        />
      </div>

      {status === "resolved" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="resolutionPhoto">Resolution photo (optional)</Label>
          <input
            id="resolutionPhoto"
            type="file"
            accept="image/*"
            onChange={async (e) => {
              // Downscaled in the browser, exactly as the citizen's capture
              // does. A raw phone camera JPEG is several megabytes and blows
              // past the platform's request-body limit before our own 8MB
              // check ever runs.
              const file = e.target.files?.[0];
              setResolutionPhoto(file ? await downscaleImage(file) : null);
            }}
            className="text-sm"
          />
        </div>
      )}

      <Button onClick={handleSubmit} disabled={submitting}>
        {submitting ? "Updating..." : "Update status"}
      </Button>
    </div>
  );
}
