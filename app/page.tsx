import { getCurrentProfile } from "@/lib/auth";
import { LandingContent } from "@/components/landing/landing-content";

export default async function Home() {
  const profile = await getCurrentProfile();
  const primaryHref = profile
    ? profile.role === "officer" || profile.role === "admin"
      ? "/dashboard"
      : "/report"
    : "/signup";

  return <LandingContent signedIn={Boolean(profile)} primaryHref={primaryHref} />;
}
