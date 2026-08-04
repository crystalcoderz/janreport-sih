"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function CityBriefing() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch("/api/kimi/briefing", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not generate a briefing");
        return;
      }
      setBriefing(data.briefing);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" />
          AI City Briefing
        </CardTitle>
        <Button size="sm" variant="outline" onClick={generate} disabled={loading}>
          {briefing ? (
            <RefreshCw className="size-3.5" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {loading ? "Generating..." : briefing ? "Regenerate" : "Generate briefing"}
        </Button>
      </CardHeader>
      <CardContent>
        {briefing ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{briefing}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Get an AI-written summary of city-wide issue trends and department
            recommendations, generated from the live stats below.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
