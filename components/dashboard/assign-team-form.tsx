"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Users, Phone, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const UNASSIGNED = "__unassigned__";

export function AssignTeamForm({
  issueId,
  teams,
  currentTeamId,
  currentTeamName,
  currentTeamPhone,
  assignedAt,
}: {
  issueId: string;
  teams: { id: string; name: string; contact_phone: string | null }[];
  currentTeamId: string | null;
  currentTeamName?: string | null;
  currentTeamPhone?: string | null;
  assignedAt?: string | null;
}) {
  const router = useRouter();
  const [teamId, setTeamId] = useState<string>(currentTeamId ?? UNASSIGNED);
  const [saving, setSaving] = useState(false);

  const dirty = (currentTeamId ?? UNASSIGNED) !== teamId;

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/issues/${issueId}/assign`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: teamId === UNASSIGNED ? null : teamId }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Could not update the assignment.");
      return;
    }
    toast.success(
      teamId === UNASSIGNED
        ? "Assignment cleared"
        : `Assigned to ${teams.find((t) => t.id === teamId)?.name}`
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {currentTeamId && (
        <div className="flex items-start gap-2.5 rounded-lg bg-green-500/10 p-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
          <div className="min-w-0 text-sm">
            <p className="font-medium">{currentTeamName}</p>
            {currentTeamPhone && (
              <a
                href={`tel:${currentTeamPhone.replace(/\s/g, "")}`}
                className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              >
                <Phone className="size-3" />
                {currentTeamPhone}
              </a>
            )}
            {assignedAt && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Dispatched {new Date(assignedAt).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            )}
          </div>
        </div>
      )}

      <Select value={teamId} onValueChange={(v) => setTeamId(v ?? UNASSIGNED)}>
        <SelectTrigger>
          <SelectValue placeholder="Select a crew">
            {(v) =>
              v === UNASSIGNED || !v
                ? "Unassigned"
                : (teams.find((t) => t.id === v)?.name ?? "Unassigned")
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
          {teams.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {teams.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No crews set up for this department yet.
        </p>
      )}

      <Button onClick={save} disabled={saving || !dirty} className="w-full">
        <Users className="size-4" />
        {saving
          ? "Saving…"
          : currentTeamId
            ? "Update assignment"
            : "Assign crew"}
      </Button>
    </div>
  );
}
