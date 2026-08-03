"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import { severityColor } from "@/lib/departments";
import type { Database } from "@/lib/supabase/types";

type Issue = Database["public"]["Tables"]["issues"]["Row"];

const DEFAULT_CENTER: [number, number] = [23.3441, 85.3096]; // Ranchi, Jharkhand

export function IssueMap({
  issues,
  center,
  zoom = 13,
  height = "420px",
  heatmap = false,
  renderPopup,
}: {
  issues: Issue[];
  center?: [number, number];
  zoom?: number;
  height?: string;
  heatmap?: boolean;
  renderPopup?: (issue: Issue) => React.ReactNode;
}) {
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
      {heatmap && <HeatmapLayer issues={issues} />}
      {!heatmap &&
        issues.map((issue) => (
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

function HeatmapLayer({ issues }: { issues: Issue[] }) {
  const map = useMap();

  useEffect(() => {
    if (issues.length === 0) return;
    const points: Array<[number, number, number]> = issues.map((i) => [
      i.lat,
      i.lng,
      Math.max(0.3, i.ai_severity / 10),
    ]);
    const layer = L.heatLayer(points, { radius: 28, blur: 22, maxZoom: 17 });
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [issues, map]);

  return null;
}
