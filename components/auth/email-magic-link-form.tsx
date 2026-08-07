"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mail } from "lucide-react";

export function EmailMagicLinkForm() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        ...(fullName ? { data: { full_name: fullName } } : {}),
      },
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p>
          We sent a sign-in link to <span className="font-medium">{sentTo}</span>. Open
          it on this device to continue — no password needed.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setSentTo(null)}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={sendLink} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email-name">Your name (first time only)</Label>
        <Input
          id="email-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <Button type="submit" disabled={loading}>
        <Mail className="size-4" />
        {loading ? "Sending..." : "Send sign-in link"}
      </Button>
    </form>
  );
}
