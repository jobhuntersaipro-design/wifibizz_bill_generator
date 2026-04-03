"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface UsageData {
  current: number;
  limit: number;
  remaining: number;
}

export function CaseUsage() {
  const [usage, setUsage] = useState<UsageData | null>(null);

  useEffect(() => {
    fetch("/api/cases/usage")
      .then((res) => res.json())
      .then((data: UsageData) => setUsage(data))
      .catch(() => {});
  }, []);

  if (!usage) return null;

  const percentage = Math.min(100, (usage.current / usage.limit) * 100);
  const isAtLimit = usage.remaining === 0;
  const isNearLimit = usage.remaining > 0 && usage.remaining <= 2;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Case Usage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold">{usage.current}</span>
          <span className="text-sm text-muted-foreground">
            / {usage.limit} cases
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isAtLimit
                ? "bg-destructive"
                : isNearLimit
                  ? "bg-amber-500"
                  : "bg-primary"
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>

        {isAtLimit && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm">
            <p className="font-medium text-destructive">
              Case limit reached ({usage.current}/{usage.limit})
            </p>
            <p className="text-muted-foreground mt-1">
              Need more?{" "}
              <a
                href="mailto:support@wifibizz.com"
                className="text-primary underline underline-offset-2"
              >
                Contact us
              </a>
            </p>
          </div>
        )}

        {isNearLimit && (
          <p className="text-sm text-amber-600">
            {usage.remaining} case{usage.remaining === 1 ? "" : "s"} remaining
          </p>
        )}
      </CardContent>
    </Card>
  );
}
