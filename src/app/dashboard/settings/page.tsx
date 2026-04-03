"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  saveWifibizzCredentials,
  getWifibizzCredentials,
} from "@/actions/settings";
import { toast } from "sonner";

export default function SettingsPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [lastCrawlAt, setLastCrawlAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWifibizzCredentials().then((result) => {
      if (result.success && result.data) {
        setEmail(result.data.email);
        setHasCredentials(true);
        setLastCrawlAt(result.data.lastCrawlAt);
      }
      setLoading(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const result = await saveWifibizzCredentials(email, password);

    if (result.success) {
      toast.success("Credentials saved successfully");
      setHasCredentials(true);
      setPassword("");
    } else {
      toast.error(result.error ?? "Failed to save credentials");
    }

    setSaving(false);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <Card>
          <CardContent className="py-12">
            <p className="text-center text-muted-foreground text-sm">
              Loading...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">WifiBizz Credentials</CardTitle>
          <CardDescription>
            {hasCredentials
              ? "Your credentials are saved. Update them below if needed."
              : "Enter your WifiBizz login to enable crawling."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wifibizz-email">WifiBizz Email</Label>
              <Input
                id="wifibizz-email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wifibizz-password">
                WifiBizz Password
                {hasCredentials && (
                  <span className="text-muted-foreground font-normal ml-1">
                    (leave blank to keep current)
                  </span>
                )}
              </Label>
              <Input
                id="wifibizz-password"
                type="password"
                placeholder={hasCredentials ? "••••••••" : "Enter password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!hasCredentials}
              />
            </div>

            {lastCrawlAt && (
              <p className="text-xs text-muted-foreground">
                Last crawl:{" "}
                {new Date(lastCrawlAt).toLocaleString()}
              </p>
            )}

            <Button type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : hasCredentials
                  ? "Update Credentials"
                  : "Save Credentials"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
