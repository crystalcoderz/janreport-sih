"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FileCheck2, CheckCircle2, Download } from "lucide-react";
import { toast } from "sonner";

export function SendAcknowledgementButton({
  issueId,
  sentAt,
}: {
  issueId: string;
  sentAt: string | null;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(null);

  async function send() {
    setSending(true);
    const res = await fetch(`/api/issues/${issueId}/acknowledge`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setSending(false);

    if (!res.ok) {
      toast.error(data?.error ?? "Could not send the acknowledgement.");
      return;
    }
    if (data.pdfUrl) setLastPdfUrl(data.pdfUrl);

    if (data.sent) {
      toast.success("Acknowledgement letter sent to the citizen on WhatsApp.");
      router.refresh();
    } else {
      toast.warning(data.message ?? "Letter generated but not delivered.");
    }
  }

  if (sentAt) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg bg-green-500/10 p-3 text-sm">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
        <div>
          <p className="font-medium">Acknowledgement sent</p>
          <p className="text-xs text-muted-foreground">
            {new Date(sentAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={send} disabled={sending} className="w-full">
        <FileCheck2 className="size-4" />
        {sending ? "Preparing letter…" : "Send Acknowledgement"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Generates a formal letter with the citizen&apos;s photo, location, and nearest
        municipal office, and sends it as a WhatsApp document.
      </p>
      {lastPdfUrl && (
        <a
          href={lastPdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <Download className="size-3" />
          Download the generated letter
        </a>
      )}
    </div>
  );
}
