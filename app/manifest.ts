import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JanReport — Civic Issue Reporting",
    short_name: "JanReport",
    description:
      "Report civic issues with a photo — AI classifies, routes, and tracks resolution in real time.",
    start_url: "/report",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#171717",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
