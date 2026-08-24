import type { MetadataRoute } from "next";

// There was no crawl policy at all, which for this app is the wrong default:
// almost every route is behind auth and answers a redirect to /login, so a
// crawler spends its budget collecting copies of the sign-in page. The two
// genuinely public entry points are the root (which redirects out to
// WhatsApp) and /login itself.
//
// Citizen and officer areas are listed explicitly rather than relying on the
// auth redirect. A disallow is not a security control -- the redirect is --
// but there is no reason to invite a crawler at a citizen's report timeline.
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login"],
      disallow: [
        "/api/",
        "/report",
        "/my-reports",
        "/issues/",
        "/map",
        "/alerts",
        "/volunteer",
        "/dashboard",
        "/analytics",
        "/bot-users",
        "/auth/",
      ],
    },
    ...(base ? { host: base } : {}),
  };
}
