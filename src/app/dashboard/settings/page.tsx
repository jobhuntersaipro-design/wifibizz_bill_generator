"use client";

import { useState, useEffect } from "react";
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
        <div>
          <h1 className="text-2xl font-semibold text-[#0A2540]">Settings</h1>
        </div>
        <div className="bg-white rounded-lg border border-[#E3E8EF] p-12">
          <div className="flex flex-col items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
            <p className="text-sm text-[#697386]">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Settings</h1>
        <p className="text-sm text-[#697386] mt-1">
          Manage your WifiBizz integration credentials
        </p>
      </div>

      <div className="max-w-xl">
        <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E3E8EF]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#F6F9FC] flex items-center justify-center">
                <KeyIcon className="w-4 h-4 text-[#635BFF]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[#0A2540]">
                  WifiBizz Credentials
                </h2>
                <p className="text-xs text-[#697386] mt-0.5">
                  {email
                    ? "Your email is set by admin. Enter your password below."
                    : "No email assigned. Contact your administrator."}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6">
            {email ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="wifibizz-email" className="text-xs font-medium text-[#425466]">
                    WifiBizz Email
                  </Label>
                  <Input
                    id="wifibizz-email"
                    type="email"
                    value={email}
                    disabled
                    className="bg-[#F6F9FC] border-[#E3E8EF] rounded-lg h-10 text-[#697386]"
                  />
                  <p className="text-[11px] text-[#697386]">
                    Set by administrator. Contact admin to change.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="wifibizz-password" className="text-xs font-medium text-[#425466]">
                    WifiBizz Password
                    {hasPassword && (
                      <span className="font-normal ml-1 text-[#697386]">
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
                    className="rounded-lg h-10 border-[#E3E8EF] focus:border-[#635BFF]"
                  />
                </div>

                {lastCrawlAt && (
                  <div className="flex items-center gap-2 text-xs text-[#697386] bg-[#F6F9FC] rounded-lg px-4 py-2.5">
                    <ClockIcon className="w-3.5 h-3.5" />
                    Last crawl: {new Date(lastCrawlAt).toLocaleString()}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={saving}
                  className="h-10 px-5 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] transition-colors duration-150"
                >
                  {saving
                    ? "Saving..."
                    : hasPassword
                      ? "Update Password"
                      : "Save Password"}
                </Button>
              </form>
            ) : (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="w-12 h-12 rounded-lg bg-[#F6F9FC] flex items-center justify-center mb-4">
                  <AlertIcon className="w-5 h-5 text-[#697386]" />
                </div>
                <p className="text-sm font-medium text-[#425466] mb-1">
                  No email assigned
                </p>
                <p className="text-xs text-[#697386] max-w-[280px]">
                  Your administrator has not assigned a WifiBizz email to your
                  account yet. Please contact them to get started.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
