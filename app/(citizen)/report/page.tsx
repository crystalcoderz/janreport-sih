"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { PhotoCapture } from "@/components/issue/photo-capture";
import { SeverityBadge } from "@/components/issue/severity-badge";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { useSpeechToText } from "@/lib/hooks/use-speech-to-text";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type IssueCategory } from "@/lib/departments";
import type { Database } from "@/lib/supabase/types";
import { MapPin, Sparkles, ThumbsUp, CheckCircle2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";

function categoryKey(category: string): TranslationKey {
  return `category.${category}` as TranslationKey;
}

type Issue = Database["public"]["Tables"]["issues"]["Row"] & {
  departments?: { name: string } | null;
};

interface Classification {
  category: IssueCategory;
  severity: number;
  severityLabel: string;
  confidence: number;
  title: string;
  description: string;
}

type ViewState =
  | { step: "form" }
  | { step: "duplicates"; classification: Classification; duplicates: Issue[] }
  | { step: "success"; issue: Issue };

export default function ReportPage() {
  const { position, status: geoStatus, error: geoError, locate } =
    useGeolocation();
  const [photo, setPhoto] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<ViewState>({ step: "form" });
  const speech = useSpeechToText();
  const { t } = useTranslation();

  function toggleVoiceNote() {
    if (speech.listening) {
      speech.stop();
      if (speech.transcript) {
        setNote((prev) => (prev ? `${prev} ${speech.transcript}`.trim() : speech.transcript));
        speech.reset();
      }
    } else {
      speech.reset();
      speech.start();
    }
  }

  async function submitReport(forceNew: boolean) {
    if (!photo) {
      toast.error(t("report.addPhotoFirst"));
      return;
    }
    if (!position) {
      toast.error(t("report.shareLocationFirst"));
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("photo", photo);
      formData.set("lat", String(position.lat));
      formData.set("lng", String(position.lng));
      if (note) formData.set("note", note);
      if (email) formData.set("email", email);
      if (forceNew) formData.set("forceNew", "true");

      const res = await fetch("/api/issues", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Something went wrong. Please try again.");
        return;
      }

      if (data.duplicates) {
        setView({
          step: "duplicates",
          classification: data.classification,
          duplicates: data.duplicates,
        });
      } else {
        toast.success(t("report.reportedSuccess"));
        setView({ step: "success", issue: data.issue });
      }
    } catch {
      toast.error(t("report.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function upvoteExisting(issueId: string) {
    const res = await fetch(`/api/issues/${issueId}/upvote`, {
      method: "POST",
    });
    if (res.ok) {
      toast.success(t("report.upvotedExisting"));
      resetForm();
    } else {
      toast.error(t("report.upvoteFailed"));
    }
  }

  function resetForm() {
    setPhoto(null);
    setNote("");
    setView({ step: "form" });
  }

  if (view.step === "success") {
    return <SuccessCard issue={view.issue} onReportAnother={resetForm} />;
  }

  if (view.step === "duplicates") {
    return (
      <DuplicatesCard
        classification={view.classification}
        duplicates={view.duplicates}
        onUpvote={upvoteExisting}
        onReportAnyway={() => submitReport(true)}
        submitting={submitting}
      />
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>{t("report.title")}</CardTitle>
          <CardDescription>{t("report.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label>{t("report.photoLabel")}</Label>
            <PhotoCapture onChange={setPhoto} />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("report.locationLabel")}</Label>
            {position ? (
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                <MapPin className="size-4 text-primary" />
                {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
                <span className="text-muted-foreground">
                  (±{Math.round(position.accuracy)}m)
                </span>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={locate}
                disabled={geoStatus === "locating"}
              >
                <MapPin className="size-4" />
                {geoStatus === "locating"
                  ? t("report.gettingLocation")
                  : t("report.shareLocation")}
              </Button>
            )}
            {geoError && <p className="text-sm text-destructive">{geoError}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("report.emailLabel")}</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t("report.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("report.emailHint")}</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="note">{t("report.noteLabel")}</Label>
              {speech.supported && (
                <Button
                  type="button"
                  size="sm"
                  variant={speech.listening ? "default" : "outline"}
                  onClick={toggleVoiceNote}
                >
                  {speech.listening ? (
                    <>
                      <Square className="size-3.5" />
                      {t("report.stop")}
                    </>
                  ) : (
                    <>
                      <Mic className="size-3.5" />
                      {t("report.speakNote")}
                    </>
                  )}
                </Button>
              )}
            </div>
            <Textarea
              id="note"
              placeholder={t("report.notePlaceholder")}
              value={speech.listening && speech.transcript ? `${note} ${speech.transcript}`.trim() : note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
            {speech.listening && (
              <p className="text-xs text-muted-foreground">{t("report.listening")}</p>
            )}
          </div>

          <Button
            size="lg"
            disabled={submitting || !photo || !position}
            onClick={() => submitReport(false)}
          >
            <Sparkles className="size-4" />
            {submitting ? t("report.analyzing") : t("report.submit")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SuccessCard({
  issue,
  onReportAnother,
}: {
  issue: Issue;
  onReportAnother: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle2 className="size-5" />
            <CardTitle>{t("report.successTitle")}</CardTitle>
          </div>
          <CardDescription>
            {t("report.routedTo")} {issue.departments?.name ?? "the relevant department"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Image
            src={issue.photo_url}
            alt={issue.title}
            width={640}
            height={360}
            unoptimized
            className="h-48 w-full rounded-md object-cover"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
              {t(categoryKey(issue.ai_category))}
            </span>
            <SeverityBadge severity={issue.ai_severity} />
            <span className="text-xs text-muted-foreground">
              {Math.round(issue.ai_confidence * 100)}% {t("report.aiConfidence")}
            </span>
          </div>
          <div>
            <p className="font-medium">{issue.title}</p>
            <p className="text-sm text-muted-foreground">{issue.description}</p>
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              nativeButton={false}
              render={<Link href="/my-reports">{t("report.trackThisReport")}</Link>}
            />
            <Button variant="outline" className="flex-1" onClick={onReportAnother}>
              {t("report.reportAnother")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DuplicatesCard({
  classification,
  duplicates,
  onUpvote,
  onReportAnyway,
  submitting,
}: {
  classification: Classification;
  duplicates: Issue[];
  onUpvote: (issueId: string) => void;
  onReportAnyway: () => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>{t("report.duplicateTitle")}</CardTitle>
          <CardDescription className="flex flex-col gap-1">
            {/* A label pair rather than a sentence: it carries the count and
                category without needing grammar that differs per language. */}
            <span className="font-medium">
              {t(categoryKey(classification.category))} · {duplicates.length}
            </span>
            {t("report.duplicateBody")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {duplicates.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 rounded-md border p-3"
            >
              <Image
                src={d.photo_url}
                alt={d.title}
                width={64}
                height={64}
                unoptimized
                className="size-16 shrink-0 rounded object-cover"
              />
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{d.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {d.address ?? `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}`}
                </p>
              </div>
              <Button size="sm" onClick={() => onUpvote(d.id)}>
                <ThumbsUp className="size-4" />
                {t("report.upvote")}
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            disabled={submitting}
            onClick={onReportAnyway}
          >
            {t("report.submitAsNew")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
