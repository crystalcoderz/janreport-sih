"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORY_LABELS, ISSUE_CATEGORIES, type IssueCategory } from "@/lib/departments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BadgeCheck, HeartHandshake } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type VolunteerGroup = Database["public"]["Tables"]["volunteer_groups"]["Row"];

export function VolunteerDirectory({
  userId,
  canVerify,
  initialGroups,
}: {
  userId: string;
  canVerify: boolean;
  initialGroups: VolunteerGroup[];
}) {
  const [groups, setGroups] = useState<VolunteerGroup[]>(initialGroups);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [categories, setCategories] = useState<Set<IssueCategory>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  function toggleCategory(c: IssueCategory) {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  async function register() {
    if (!name.trim()) {
      toast.error("Give your group a name first.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("volunteer_groups")
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        contact_phone: phone.trim() || null,
        contact_email: email.trim() || null,
        categories: Array.from(categories),
        created_by: userId,
      })
      .select()
      .single();
    setSubmitting(false);

    if (error || !data) {
      toast.error("Could not register your group. Please try again.");
      return;
    }
    setGroups((prev) => [data, ...prev]);
    setName("");
    setDescription("");
    setPhone("");
    setEmail("");
    setCategories(new Set());
    toast.success("Registered — thanks for helping out!");
  }

  async function toggleVerified(group: VolunteerGroup) {
    const supabase = createClient();
    const { error } = await supabase
      .from("volunteer_groups")
      .update({ verified: !group.verified })
      .eq("id", group.id);
    if (error) {
      toast.error("Could not update verification status.");
      return;
    }
    setGroups((prev) =>
      prev.map((g) => (g.id === group.id ? { ...g, verified: !g.verified } : g))
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Volunteers &amp; NGOs</h1>
        <p className="text-muted-foreground">
          Register your NGO or citizen group to help resolve smaller issues —
          garbage cleanups, tree planting, and more.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Register your group</CardTitle>
          <CardDescription>
            Officers/admins verify legitimate groups before they&apos;re
            badged in the directory.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="vg-name">Group name</Label>
            <Input
              id="vg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ranchi Green Warriors"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="vg-description">What do you do?</Label>
            <Textarea
              id="vg-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description of your group and how you help."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="vg-phone">Contact phone</Label>
              <Input
                id="vg-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91..."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="vg-email">Contact email</Label>
              <Input
                id="vg-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.org"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Issue types you help with</Label>
            <div className="flex flex-wrap gap-1.5">
              {ISSUE_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    categories.has(c)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </div>
          <Button disabled={submitting} onClick={register} className="self-start">
            <HeartHandshake className="size-4" />
            Register group
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Directory</h2>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No groups registered yet — be the first.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {groups.map((g) => (
              <Card key={g.id}>
                <CardContent className="flex flex-col gap-2 pt-6">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-medium">
                      {g.name}
                      {g.verified && (
                        <BadgeCheck className="size-4 text-primary" />
                      )}
                    </div>
                    {canVerify && (
                      <Button
                        size="xs"
                        variant={g.verified ? "outline" : "secondary"}
                        onClick={() => toggleVerified(g)}
                      >
                        {g.verified ? "Unverify" : "Verify"}
                      </Button>
                    )}
                  </div>
                  {g.description && (
                    <p className="text-sm text-muted-foreground">{g.description}</p>
                  )}
                  {g.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {g.categories.map((c) => (
                        <Badge key={c} variant="outline">
                          {CATEGORY_LABELS[c as IssueCategory] ?? c}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {(g.contact_phone || g.contact_email) && (
                    <p className="text-xs text-muted-foreground">
                      {[g.contact_phone, g.contact_email].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
