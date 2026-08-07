"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Camera, MapPin, Route, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { cn } from "@/lib/utils";

export function LandingContent({
  signedIn,
  primaryHref,
}: {
  signedIn: boolean;
  primaryHref: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
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
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,color-mix(in_oklch,var(--color-primary)_18%,transparent),transparent)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 right-[10%] -z-10 size-72 rounded-full bg-primary/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute top-10 left-[8%] -z-10 size-56 rounded-full bg-emerald-500/10 blur-3xl"
          />

          <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:py-28">
            <span className="mx-auto inline-flex items-center gap-1.5 rounded-full border bg-secondary/60 px-3 py-1 text-xs font-medium text-secondary-foreground">
              <Sparkles className="size-3.5 text-primary" />
              SIH25031 · Govt of Jharkhand · Clean &amp; Green Tech
            </span>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-balance sm:text-6xl">
              {t("landing.heroTitle")}
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground text-balance">
              {t("landing.heroSubtitle")}
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button
                size="lg"
                className="px-6 shadow-lg shadow-primary/25"
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
                className="px-6"
                nativeButton={false}
                render={
                  <Link href={signedIn ? "/map" : "/login"}>
                    {t("landing.ctaViewMap")}
                  </Link>
                }
              />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-24">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Camera className="size-5" />}
              tone="blue"
              title={t("landing.featurePhotoTitle")}
              description={t("landing.featurePhotoDesc")}
            />
            <FeatureCard
              icon={<Route className="size-5" />}
              tone="emerald"
              title={t("landing.featureAiTitle")}
              description={t("landing.featureAiDesc")}
            />
            <FeatureCard
              icon={<ShieldCheck className="size-5" />}
              tone="amber"
              title={t("landing.featureRouteTitle")}
              description={t("landing.featureRouteDesc")}
            />
            <FeatureCard
              icon={<MapPin className="size-5" />}
              tone="violet"
              title={t("landing.featureTrackTitle")}
              description={t("landing.featureTrackDesc")}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

const TONE_STYLES = {
  blue: "bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  emerald:
    "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  amber:
    "bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  violet:
    "bg-violet-500/10 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
} as const;

function FeatureCard({
  icon,
  tone,
  title,
  description,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONE_STYLES;
  title: string;
  description: string;
}) {
  return (
    <Card className="border-border/60 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex flex-col gap-3 pt-6">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-lg",
            TONE_STYLES[tone]
          )}
        >
          {icon}
        </div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
