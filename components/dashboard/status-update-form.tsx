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
import { Sparkles } from "lucide-react";

const STATUS_OPTIONS: { value: IssueStatus; label: string }[] = [
  { value: "reported", label: "Reported" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
];

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
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not draft a note");
        return;
      }
      setNote(data.note);
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
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          toast.error(uploadData.error || "Failed to upload resolution photo");
          setSubmitting(false);
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
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
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
            onChange={(e) => setResolutionPhoto(e.target.files?.[0] ?? null)}
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
