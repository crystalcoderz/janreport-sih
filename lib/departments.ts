// Canonical AI category taxonomy. Must stay in sync with the
// `category_keys` seeded in supabase/schema.sql.
export const ISSUE_CATEGORIES = [
  "pothole",
  "road_damage",
  "water_supply",
  "drainage_sewage",
  "electricity_outage",
  "streetlight",
  "garbage_waste",
  "pollution",
  "traffic_safety",
  "accident",
  "tree_park",
  "other",
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  pothole: "Pothole",
  road_damage: "Road Damage",
  water_supply: "Water Supply",
  drainage_sewage: "Drainage & Sewage",
  electricity_outage: "Electricity Outage",
  streetlight: "Streetlight",
  garbage_waste: "Garbage & Waste",
  pollution: "Pollution",
  traffic_safety: "Traffic & Safety",
  accident: "Accident",
  tree_park: "Trees & Parks",
  other: "Other",
};

export const SEVERITY_LABELS: Record<number, string> = {
  1: "Minimal",
  2: "Minimal",
  3: "Low",
  4: "Low",
  5: "Moderate",
  6: "Moderate",
  7: "High",
  8: "High",
  9: "Critical",
  10: "Critical",
};

export function severityLabel(score: number): string {
  return SEVERITY_LABELS[Math.min(10, Math.max(1, Math.round(score)))];
}

export function severityColor(score: number): string {
  if (score >= 9) return "#dc2626"; // critical - red-600
  if (score >= 7) return "#ea580c"; // high - orange-600
  if (score >= 5) return "#d97706"; // moderate - amber-600
  return "#16a34a"; // low/minimal - green-600
}
