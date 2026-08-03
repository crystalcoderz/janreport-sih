import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Camera, MapPin, Route, ShieldCheck } from "lucide-react";

export default async function Home() {
  const profile = await getCurrentProfile();
  const primaryHref = profile
    ? profile.role === "officer" || profile.role === "admin"
      ? "/dashboard"
      : "/report"
    : "/signup";

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <MapPin className="size-5 text-primary" />
            JanReport
          </div>
          <div className="flex items-center gap-2">
            {profile ? (
              <Button render={<Link href={primaryHref}>Go to app</Link>} />
            ) : (
              <>
                <Button
                  variant="ghost"
                  render={<Link href="/login">Sign in</Link>}
                />
                <Button render={<Link href="/signup">Get started</Link>} />
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-20 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            See a civic issue? Report it in seconds.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Snap a photo, share your location — AI classifies the issue,
            scores its severity, and routes it to the right municipal
            department automatically. Track resolution in real time.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              render={
                <Link href={primaryHref}>
                  {profile ? "Open JanReport" : "Report an issue"}
                </Link>
              }
            />
            <Button
              size="lg"
              variant="outline"
              render={
                <Link href={profile ? "/map" : "/login"}>View live map</Link>
              }
            />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Camera className="size-5" />}
              title="Photo + GPS"
              description="Capture the issue with your camera — location is tagged automatically."
            />
            <FeatureCard
              icon={<Route className="size-5" />}
              title="AI classification"
              description="Claude vision AI categorizes the issue and scores severity instantly."
            />
            <FeatureCard
              icon={<ShieldCheck className="size-5" />}
              title="Auto-routed"
              description="Issues are routed straight to the responsible department — no manual triage."
            />
            <FeatureCard
              icon={<MapPin className="size-5" />}
              title="Live tracking"
              description="Follow your report's status in real time, from reported to resolved."
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-6">
        <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
