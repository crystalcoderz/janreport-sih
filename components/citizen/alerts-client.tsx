"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { MapPin, MapPinOff, MapPinned } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { useIssueNotifications, type NearbyAlert } from "@/lib/hooks/use-issue-notifications";
import {
  AREA_ALERT_CATEGORIES,
  CATEGORY_LABELS,
  type IssueCategory,
} from "@/lib/departments";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const RADIUS_OPTIONS = [100, 250, 500, 1000, 2000];

export function AlertsClient({
  userId,
  homeLat,
  homeLng,
  notifyRadiusM,
  initialAlerts,
}: {
  userId: string;
  homeLat: number | null;
  homeLng: number | null;
  notifyRadiusM: number;
  initialAlerts: NearbyAlert[];
}) {
  const { alerts, markAllRead } = useIssueNotifications(userId, initialAlerts);
  const { position, status: geoStatus, error: geoError, locate } = useGeolocation();
  const [savedLocation, setSavedLocation] = useState(
    homeLat !== null && homeLng !== null ? { lat: homeLat, lng: homeLng } : null
  );
  const [radius, setRadius] = useState(String(notifyRadiusM));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    markAllRead();
    // Only clear the unread badge once, on entering this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingLocation = position ?? savedLocation;

  async function saveLocation() {
    if (!position) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        home_lat: position.lat,
        home_lng: position.lng,
        notify_radius_m: Number(radius),
      })
      .eq("id", userId);
    setSaving(false);

    if (error) {
      toast.error("Could not save your alert location. Please try again.");
      return;
    }
    setSavedLocation({ lat: position.lat, lng: position.lng });
    toast.success("Nearby alerts are set up.");
  }

  async function saveRadiusOnly(next: string) {
    setRadius(next);
    if (!savedLocation) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ notify_radius_m: Number(next) })
      .eq("id", userId);
    if (error) {
      toast.error("Could not update your alert radius.");
    }
  }

  async function clearLocation() {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ home_lat: null, home_lng: null })
      .eq("id", userId);
    setSaving(false);

    if (error) {
      toast.error("Could not turn off nearby alerts.");
      return;
    }
    setSavedLocation(null);
    toast.success("Nearby alerts turned off.");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Nearby Alerts</h1>
        <p className="text-muted-foreground">
          Get notified when an area-wide issue — like a water shortage or power
          outage — is reported near you, even if you didn&apos;t report it
          yourself.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your alert location</CardTitle>
          <CardDescription>
            We only use this to match your location against new reports —
            it&apos;s never shown to other citizens.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {pendingLocation ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
              <MapPin className="size-4 text-primary" />
              {pendingLocation.lat.toFixed(5)}, {pendingLocation.lng.toFixed(5)}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No alert location set yet — you won&apos;t receive nearby alerts
              until you set one.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={locate}
            disabled={geoStatus === "locating"}
            className="self-start"
          >
            <MapPin className="size-4" />
            {geoStatus === "locating"
              ? "Getting location..."
              : savedLocation
                ? "Update to current location"
                : "Use my current location"}
          </Button>
          {geoError && <p className="text-sm text-destructive">{geoError}</p>}

          <div className="flex flex-col gap-2">
            <Label>Alert radius</Label>
            <Select value={radius} onValueChange={(v) => v && saveRadiusOnly(v)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RADIUS_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m >= 1000 ? `${m / 1000} km` : `${m} m`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!position || saving}
              onClick={saveLocation}
            >
              <MapPinned className="size-4" />
              Save alert location
            </Button>
            {savedLocation && (
              <Button variant="outline" disabled={saving} onClick={clearLocation}>
                <MapPinOff className="size-4" />
                Turn off alerts
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            You&apos;ll be alerted for:{" "}
            {AREA_ALERT_CATEGORIES.map((c) => CATEGORY_LABELS[c]).join(", ")}.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Recent alerts</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No nearby alerts yet — you&apos;ll see them here as soon as
            something is reported within your radius.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {alerts.map((alert) => (
              <Link key={alert.id} href={`/issues/${alert.issueId}`}>
                <Card className="transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {CATEGORY_LABELS[alert.issueCategory as IssueCategory] ??
                          alert.issueCategory}{" "}
                        reported nearby
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {alert.issueAddress ?? alert.issueTitle}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(alert.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
