"use client";

import { useEffect, useState } from "react";
import { APIProvider, Map, AdvancedMarker, InfoWindow } from "@vis.gl/react-google-maps";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { severityColor } from "@/lib/departments";
import type { Database } from "@/lib/supabase/types";

type Issue = Database["public"]["Tables"]["issues"]["Row"];

// Knowledge Park, Greater Noida — beside GLA/GL Bajaj, which is where the
// demo is given and where the seeded and WhatsApp-filed reports cluster.
const DEFAULT_CENTER: [number, number] = [28.4778, 77.4921];

// A real Map ID (Google Cloud Console -> Maps -> Map IDs) unlocks custom
// cloud-based styling; this placeholder id works out of the box for
// AdvancedMarker without one.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

interface MapProps {
  issues: Issue[];
  center?: [number, number];
  zoom?: number;
  height?: string;
  renderPopup?: (issue: Issue) => React.ReactNode;
}

// Loads the Maps script exactly once, outside React entirely, so success
// or failure (API not activated, billing, referrer restrictions — any of
// Google's "auth"-class errors) is known BEFORE the Google-backed React
// map ever mounts. Mounting it and then tearing it down after a failed
// load crashes — @vis.gl/react-google-maps does its own direct DOM
// manipulation outside React's tracking, and React reconciling against
// nodes Google already tore down itself throws "Cannot read properties of
// undefined (reading 'getRootNode')". Caching the promise means every
// IssueMap instance on a page shares one canary load, not one each.
let googleMapsCanary: Promise<boolean> | null = null;

// Remembers a *successful* canary for the rest of the browsing session, so
// heavier pages (issue detail, with its photos/timeline/comments) don't
// re-race the probe against its own timeout and fall back to OSM even
// though Google works fine. Deliberately one-way: failures are never
// cached, so enabling the API in Google Cloud takes effect on the very
// next page load instead of being stuck behind a stale "broken" verdict.
const CANARY_CACHE_KEY = "janreport:google-maps-ok";

function readCachedCanary(): boolean {
  try {
    return sessionStorage.getItem(CANARY_CACHE_KEY) === "1";
  } catch {
    return false; // private mode / storage disabled — just re-probe
  }
}

function cacheCanarySuccess(): void {
  try {
    sessionStorage.setItem(CANARY_CACHE_KEY, "1");
  } catch {
    // Non-fatal: we simply re-probe on the next page.
  }
}

function clearCachedCanary(): void {
  try {
    sessionStorage.removeItem(CANARY_CACHE_KEY);
  } catch {
    // Non-fatal.
  }
}

function checkGoogleMapsAvailable(apiKey: string): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (googleMapsCanary) return googleMapsCanary;

  if (readCachedCanary()) {
    googleMapsCanary = Promise.resolve(true);
    return googleMapsCanary;
  }

  googleMapsCanary = new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (ok) cacheCanarySuccess();
      resolve(ok);
    };

    // Loading the script alone isn't enough to know activation status —
    // it parses fine even when the API isn't activated on the project.
    // Google only surfaces that (via gm_authFailure) once something
    // actually tries to create a Map, so the canary has to do that too and
    // treat "tiles finished loading" as the real success signal.
    //
    // The probe container must be *within the viewport* — Google defers
    // initialising a map whose container is scrolled/positioned off-screen
    // (top:-9999px fires no events at all, not even projection_changed, so
    // the canary times out and falls back even on a perfectly good key).
    // Hide it with opacity instead, which still counts as visible.
    const probe = () => {
      try {
        const div = document.createElement("div");
        div.style.cssText =
          "position:fixed;top:0;left:0;width:120px;height:120px;opacity:0;pointer-events:none;z-index:-1;";
        document.body.appendChild(div);
        const map = new google.maps.Map(div, {
          center: { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] },
          zoom: 13,
          mapId: "DEMO_MAP_ID",
          disableDefaultUI: true,
        });
        google.maps.event.addListenerOnce(map, "tilesloaded", () => {
          finish(true);
          div.remove();
        });
      } catch {
        finish(false);
      }
    };

    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => finish(false);

    if ((window as unknown as { google?: { maps?: unknown } }).google?.maps) {
      probe();
      return;
    }

    (window as unknown as Record<string, () => void>).__janreportMapsCanary = probe;

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=visualization&callback=__janreportMapsCanary&loading=async`;
    script.async = true;
    script.onerror = () => finish(false);
    document.head.appendChild(script);

    // Generous: this only ever runs once per session (a success is cached
    // from then on), and a heavily-loading page can legitimately take a
    // while to fetch the script plus a first tile.
    setTimeout(() => finish(false), 12000);
  });

  return googleMapsCanary;
}

// Tries Google Maps first (modern look); if the API key isn't fully set up
// on Google's side, falls back to the free OpenStreetMap map instead of
// showing Google's broken-tile error box. No redeploy needed to pick up
// the nicer map once the key is fixed on Google's side — this same code
// starts succeeding immediately.
export function IssueMap(props: MapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [status, setStatus] = useState<"checking" | "google" | "leaflet">(
    apiKey ? "checking" : "leaflet"
  );

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    // If Google ever rejects us at runtime (key edited, quota, referrer
    // restriction added mid-session), drop the cached success and swap
    // this map to OSM rather than leaving Google's error box on screen.
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
      clearCachedCanary();
      googleMapsCanary = Promise.resolve(false);
      if (!cancelled) setStatus("leaflet");
    };

    checkGoogleMapsAvailable(apiKey).then((ok) => {
      if (!cancelled) setStatus(ok ? "google" : "leaflet");
    });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  if (status === "checking") {
    return (
      <div
        className="animate-pulse rounded-lg bg-muted"
        style={{ height: props.height ?? "420px", width: "100%" }}
      />
    );
  }

  if (status === "leaflet") {
    return <LeafletIssueMap {...props} />;
  }

  return <GoogleIssueMap {...props} apiKey={apiKey!} />;
}

function GoogleIssueMap({
  issues,
  center,
  zoom = 13,
  height = "420px",
  renderPopup,
  apiKey,
}: MapProps & { apiKey: string }) {
  const [selected, setSelected] = useState<Issue | null>(null);

  return (
    <APIProvider apiKey={apiKey} libraries={["visualization"]}>
      <Map
        defaultCenter={{ lat: (center ?? DEFAULT_CENTER)[0], lng: (center ?? DEFAULT_CENTER)[1] }}
        defaultZoom={zoom}
        mapId={MAP_ID}
        style={{ height, width: "100%", borderRadius: "0.5rem" }}
        gestureHandling="greedy"
        disableDefaultUI={false}
        clickableIcons={false}
      >
        {          issues.map((issue) => (
            <AdvancedMarker
              key={issue.id}
              position={{ lat: issue.lat, lng: issue.lng }}
              onClick={() => setSelected(issue)}
            >
              <div
                style={{
                  width: Math.min(36, 16 + Math.log2(issue.upvote_count + 1) * 4),
                  height: Math.min(36, 16 + Math.log2(issue.upvote_count + 1) * 4),
                  borderRadius: "9999px",
                  background: severityColor(issue.ai_severity),
                  border: "2px solid white",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                }}
              />
            </AdvancedMarker>
          ))}
        {selected && (
          <InfoWindow
            position={{ lat: selected.lat, lng: selected.lng }}
            onCloseClick={() => setSelected(null)}
          >
            {renderPopup ? renderPopup(selected) : selected.title}
          </InfoWindow>
        )}
      </Map>
    </APIProvider>
  );
}

// Fallback map — no API key or Google account setup required.
function LeafletIssueMap({
  issues,
  center,
  zoom = 13,
  height = "420px",
  renderPopup,
}: MapProps) {
  return (
    <MapContainer
      center={center ?? DEFAULT_CENTER}
      zoom={zoom}
      style={{ height, width: "100%", borderRadius: "0.5rem" }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {        issues.map((issue) => (
          <CircleMarker
            key={issue.id}
            center={[issue.lat, issue.lng]}
            radius={Math.min(18, 8 + Math.log2(issue.upvote_count + 1) * 2)}
            pathOptions={{
              color: severityColor(issue.ai_severity),
              fillColor: severityColor(issue.ai_severity),
              fillOpacity: 0.6,
              weight: 2,
            }}
          >
            <Popup>{renderPopup ? renderPopup(issue) : issue.title}</Popup>
          </CircleMarker>
        ))}
    </MapContainer>
  );
}

