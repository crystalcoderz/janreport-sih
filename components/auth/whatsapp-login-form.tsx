"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";

type Step = { stage: "phone" } | { stage: "code"; phone: string; devCode?: string };

export function WhatsAppLoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>({ stage: "phone" });
  const [loading, setLoading] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/auth/whatsapp/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast.error(data.error || "Could not send a code. Please try again.");
      return;
    }
    if (data.devCode) {
      toast.info(`WhatsApp isn't configured yet — your demo code is ${data.devCode}`);
    } else {
      toast.success("Code sent on WhatsApp.");
    }
    setStep({ stage: "code", phone, devCode: data.devCode });
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (step.stage !== "code") return;
    setLoading(true);
    const res = await fetch("/api/auth/whatsapp/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: step.phone, code, fullName }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      toast.error(data.error || "Could not verify that code.");
      return;
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: profile } = user
      ? await supabase.from("profiles").select("role").eq("id", user.id).single()
      : { data: null };

    router.push(
      profile?.role === "officer" || profile?.role === "admin"
        ? "/dashboard"
        : "/report"
    );
    router.refresh();
  }

  if (step.stage === "code") {
    return (
      <form onSubmit={verifyCode} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code sent to {step.phone} on WhatsApp.
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="wa-name">Your name (first time only)</Label>
          <Input
            id="wa-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="wa-code">Verification code</Label>
          <Input
            id="wa-code"
            inputMode="numeric"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoComplete="one-time-code"
          />
        </div>
        <Button type="submit" disabled={loading || code.length < 6}>
          {loading ? "Verifying..." : "Verify & sign in"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setStep({ stage: "phone" })}
        >
          Use a different number
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={requestCode} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="wa-phone">WhatsApp number</Label>
        <Input
          id="wa-phone"
          type="tel"
          required
          placeholder="+91 98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />
      </div>
      <Button type="submit" disabled={loading}>
        <MessageCircle className="size-4" />
        {loading ? "Sending..." : "Send code on WhatsApp"}
      </Button>
    </form>
  );
}
