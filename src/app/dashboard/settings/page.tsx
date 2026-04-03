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
  saveWifibizzPassword,
  getWifibizzCredentials,
} from "@/actions/settings";
import { toast } from "sonner";

export default function SettingsPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [lastCrawlAt, setLastCrawlAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWifibizzCredentials().then((result) => {
      if (result.success && result.data) {
        setEmail(result.data.email);
        setHasPassword(result.data.hasPassword);
        setLastCrawlAt(result.data.lastCrawlAt);
      }
      setLoading(false);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const result = await saveWifibizzPassword(password);

    if (result.success) {
      toast.success("Password saved successfully");
      setHasPassword(true);
      setPassword("");
    } else {
      toast.error(result.error ?? "Failed to save password");
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
            {email
              ? "Your WifiBizz email is set by the administrator. Enter your password below."
              : "No WifiBizz email has been assigned. Contact your administrator."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {email ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="wifibizz-email">WifiBizz Email</Label>
                <Input
                  id="wifibizz-email"
                  type="email"
                  value={email}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  Set by administrator. Contact admin to change.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wifibizz-password">
                  WifiBizz Password
                  {hasPassword && (
                    <span className="text-muted-foreground font-normal ml-1">
                      (leave blank to keep current)
                    </span>
                  )}
                </Label>
                <Input
                  id="wifibizz-password"
                  type="password"
                  placeholder={hasPassword ? "••••••••" : "Enter your WifiBizz password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required={!hasPassword}
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
                  : hasPassword
                    ? "Update Password"
                    : "Save Password"}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground py-4">
              Your administrator has not assigned a WifiBizz email to your account yet.
              Please contact them to get started.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
