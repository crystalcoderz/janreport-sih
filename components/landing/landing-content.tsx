"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MapPin, MessageCircle, ScanEye, Route, CheckCircle2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { LanguageToggle } from "@/components/layout/language-toggle";

export interface LandingStats {
  reports: number;
  resolved: number;
  departments: number;
}

export function LandingContent({
  signedIn,
  primaryHref,
  stats,
}: {
  signedIn: boolean;
  primaryHref: string;
  stats: LandingStats;
}) {
  const { t } = useTranslation();

  const steps = [
    { icon: MessageCircle, title: t("landing.step1Title"), desc: t("landing.step1Desc") },
    { icon: ScanEye, title: t("landing.step2Title"), desc: t("landing.step2Desc") },
    { icon: Route, title: t("landing.step3Title"), desc: t("landing.step3Desc") },
    { icon: CheckCircle2, title: t("landing.step4Title"), desc: t("landing.step4Desc") },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MapPin className="size-4.5" />
            </span>
            JanReport
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            {signedIn ? (
              <Button
                nativeButton={false}
                render={<Link href={primaryHref}>{t("landing.goToApp")}</Link>}
              />
            ) : (
              <>
                <Button
                  variant="ghost"
                  nativeButton={false}
                  render={<Link href="/login">{t("landing.signIn")}</Link>}
                />
                <Button
                  nativeButton={false}
                  render={<Link href="/login">{t("landing.getStarted")}</Link>}
                />
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — left-aligned and text-led. WhatsApp is the actual product,
            so it leads rather than being one feature card among four. */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <p className="font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            SIH25031 · Govt of Jharkhand · Clean &amp; Green Tech
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {t("landing.heroTitle")}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            {t("landing.heroSubtitle")}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              nativeButton={false}
              render={
                <Link href={primaryHref}>
                  {signedIn ? t("landing.ctaOpenApp") : t("landing.ctaReport")}
                </Link>
              }
            />
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={
                <Link href={signedIn ? "/map" : "/login"}>{t("landing.ctaViewMap")}</Link>
              }
            />
          </div>

          {/* Real counts from the database — a live system is more
              convincing than a claim about one. */}
          <dl className="mt-14 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
            <Stat value={stats.reports} label={t("landing.statReports")} />
            <Stat value={stats.resolved} label={t("landing.statResolved")} />
            <Stat value={stats.departments} label={t("landing.statDepartments")} />
          </dl>
        </section>

        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-5xl px-4 py-16">
            <h2 className="text-2xl font-semibold tracking-tight">
              {t("landing.howTitle")}
            </h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, i) => (
                <li key={step.title} className="relative flex flex-col gap-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-semibold text-primary">
                      {i + 1}
                    </span>
                    <step.icon className="size-4 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.desc}</p>
                </li>
              ))}
            </ol>
            <p className="mt-10 text-sm text-muted-foreground">
              {t("landing.webAlso")}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-background px-4 py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-2xl font-semibold tabular-nums">
        {value.toLocaleString("en-IN")}
      </dd>
    </div>
  );
}
