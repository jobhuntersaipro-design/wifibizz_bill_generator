"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface UsageData {
  billsGenerated: number;
  limit: number;
  remaining: number;
  internetBills: number;
  utilityBills: number;
  totalCases: number;
}

export function BillUsage() {
  const [usage, setUsage] = useState<UsageData | null>(null);

  useEffect(() => {
    fetch("/api/cases/usage")
      .then((res) => res.json())
      .then((data: UsageData) => setUsage(data))
      .catch(() => {});
  }, []);

  if (!usage) return null;

  const percentage = usage.limit > 0 ? Math.min(100, (usage.billsGenerated / usage.limit) * 100) : 0;
  const isAtLimit = usage.remaining === 0;
  const isNearLimit = usage.remaining > 0 && usage.remaining <= 2;

  return (
    <Card className="border-[#E3E8EF] bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-[#0A2540]">Bill Usage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold text-[#0A2540] tabular-nums">{usage.billsGenerated}</span>
          <span className="text-sm text-[#697386]">
            / {usage.limit} bills
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 rounded-full bg-[#F6F9FC] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isAtLimit
                ? "bg-[#DF1B41]"
                : isNearLimit
                  ? "bg-amber-500"
                  : "bg-[#635BFF]"
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Bill type breakdown */}
        <div className="flex items-center gap-4 text-xs text-[#697386]">
          <div className="flex items-center gap-1.5">
            <InternetIcon className="w-3.5 h-3.5 text-[#635BFF]" />
            <span className="tabular-nums">{usage.internetBills}</span>
            <span>Internet</span>
          </div>
          <div className="flex items-center gap-1.5">
            <UtilityIcon className="w-3.5 h-3.5 text-amber-500" />
            <span className="tabular-nums">{usage.utilityBills}</span>
            <span>Utility</span>
          </div>
        </div>

        {isAtLimit && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm">
            <p className="font-medium text-[#DF1B41]">
              Bill limit reached ({usage.billsGenerated}/{usage.limit})
            </p>
            <p className="text-[#697386] mt-1">
              Need more?{" "}
              <a
                href="mailto:support@wifibizz.com"
                className="text-[#635BFF] underline underline-offset-2"
              >
                Contact us
              </a>
            </p>
          </div>
        )}

        {isNearLimit && (
          <p className="text-sm text-amber-600">
            {usage.remaining} bill{usage.remaining === 1 ? "" : "s"} remaining
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function InternetIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

function UtilityIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}
