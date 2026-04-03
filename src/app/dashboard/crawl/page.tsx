"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function CrawlPage() {
  const [crawling, setCrawling] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    saved: number;
    skipped: number;
  } | null>(null);
  const router = useRouter();

  async function handleCrawl() {
    setCrawling(true);
    setResult(null);

    try {
      const res = await fetch("/api/crawl", { method: "POST" });
      const json = await res.json();

      if (!res.ok) {
        if (json.error === "no_credentials") {
          toast.error("Set your WifiBizz credentials in Settings first.");
          router.push("/dashboard/settings");
          return;
        }
        if (json.error === "case_limit_reached") {
          toast.error(
            `Case limit reached (${json.current}/${json.limit}). Contact us to increase.`
          );
          return;
        }
        toast.error(json.error ?? "Crawl failed");
        return;
      }

      setResult({
        total: json.total,
        saved: json.saved,
        skipped: json.skipped,
      });
      toast.success(`Crawl complete — ${json.saved} cases saved`);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setCrawling(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">New Crawl</h1>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Crawl WifiBizz</CardTitle>
          <CardDescription>
            Fetches all Home Fibre and Business Fibre cases from WifiBizz
            using your saved credentials.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleCrawl} disabled={crawling}>
            {crawling ? "Crawling..." : "Start Crawl"}
          </Button>

          {crawling && (
            <p className="text-sm text-muted-foreground">
              This may take a moment. Do not close this page.
            </p>
          )}

          {result && (
            <div className="rounded-lg border bg-muted/50 p-4 space-y-1 text-sm">
              <p>
                <span className="font-medium">Total cases found:</span>{" "}
                {result.total}
              </p>
              <p>
                <span className="font-medium">Saved to database:</span>{" "}
                {result.saved}
              </p>
              {result.skipped > 0 && (
                <p className="text-amber-600">
                  <span className="font-medium">Skipped (limit):</span>{" "}
                  {result.skipped}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => router.push("/dashboard/cases")}
              >
                View Cases
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
