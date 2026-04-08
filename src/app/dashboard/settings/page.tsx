"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  saveWifibizzPassword,
  getWifibizzCredentials,
  testWifibizzConnection,
  getGoogleSheetSettings,
  saveGoogleSheetId,
  syncCasesToSheet,
} from "@/actions/settings";
import { toast } from "sonner";

export default function SettingsPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [lastCrawlAt, setLastCrawlAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [originalPassword, setOriginalPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [googleSheetId, setGoogleSheetId] = useState("");
  const [savedSheetId, setSavedSheetId] = useState("");
  const [savingSheet, setSavingSheet] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    getWifibizzCredentials().then((result) => {
      if (result.success && result.data) {
        setEmail(result.data.email);
        setHasPassword(result.data.hasPassword);
        if (result.data.savedPassword) {
          setPassword(result.data.savedPassword);
          setOriginalPassword(result.data.savedPassword);
        }
        setLastCrawlAt(result.data.lastCrawlAt);
      }
      setLoading(false);
    });
    getGoogleSheetSettings().then((result) => {
      if (result.success && result.data) {
        setGoogleSheetId(result.data.googleSheetId ?? "");
        setSavedSheetId(result.data.googleSheetId ?? "");
        setServiceAccountEmail(result.data.serviceAccountEmail);
      }
    });
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (hasPassword && password !== originalPassword) {
      setShowConfirm(true);
    } else {
      doSave();
    }
  }

  async function doSave() {
    setShowConfirm(false);
    setSaving(true);

    const result = await saveWifibizzPassword(password);

    if (result.success) {
      toast.success("Password saved successfully");
      setHasPassword(true);
      setOriginalPassword(password);
    } else {
      toast.error(result.error ?? "Failed to save password");
    }

    setSaving(false);
  }

  async function handleSaveSheetId() {
    setSavingSheet(true);
    const result = await saveGoogleSheetId(googleSheetId);
    if (result.success) {
      toast.success(googleSheetId ? "Google Sheet ID saved" : "Google Sheet ID removed");
      setSavedSheetId(googleSheetId);
    } else {
      toast.error(result.error ?? "Failed to save");
    }
    setSavingSheet(false);
  }

  async function handleSyncToSheet() {
    setSyncing(true);
    const result = await syncCasesToSheet();
    if (result.success) {
      if (result.synced === 0) {
        toast.info("All cases already synced to sheet.");
      } else {
        toast.success(`Synced ${result.synced} case(s) to Google Sheet.`);
      }
    } else {
      toast.error(result.error ?? "Sync failed");
    }
    setSyncing(false);
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);

    const result = await testWifibizzConnection();

    if (result.success) {
      setTestResult({ success: true });
      toast.success("Connection successful! Credentials are valid.");
    } else {
      setTestResult({ success: false, error: result.error });
      toast.error(result.error ?? "Connection test failed");
    }

    setTesting(false);
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
      <div className="animate-fade-in-up" style={{ animationDelay: "100ms" }}>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Settings</h1>
        <p className="text-sm text-[#697386] mt-1">
          Manage your WifiBizz integration credentials
        </p>
      </div>

      <div className="max-w-xl animate-fade-in-up" style={{ animationDelay: "200ms" }}>
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
                  </Label>
                  <div className="relative">
                    <Input
                      id="wifibizz-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your WifiBizz password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required={!hasPassword}
                      className="rounded-lg h-10 pr-10 border-[#E3E8EF] focus:border-[#635BFF]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#697386] hover:text-[#0A2540] transition-colors"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {lastCrawlAt && (
                  <div className="flex items-center gap-2 text-xs text-[#697386] bg-[#F6F9FC] rounded-lg px-4 py-2.5">
                    <ClockIcon className="w-3.5 h-3.5" />
                    Last crawl: {new Date(lastCrawlAt).toLocaleString()}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    disabled={saving}
                    className="h-10 px-5 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] hover-glow"
                  >
                    {saving
                      ? "Saving..."
                      : hasPassword
                        ? "Update Password"
                        : "Save Password"}
                  </Button>

                  {hasPassword && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={testing}
                      onClick={handleTestConnection}
                      className="h-10 px-5 rounded-lg text-sm font-medium border-[#E3E8EF] text-[#425466] hover:border-[#635BFF] hover:text-[#635BFF] press-effect"
                    >
                      {testing ? (
                        <>
                          <span className="h-3.5 w-3.5 mr-2 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent inline-block" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <WifiIcon className="w-3.5 h-3.5 mr-2" />
                          Test Connection
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {testResult && !testResult.success && (
                  <div className="flex items-start gap-2 text-xs bg-red-50 text-red-700 rounded-lg px-4 py-2.5 animate-fade-in-up" style={{ animationDuration: "200ms" }}>
                    <AlertIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{testResult.error}</span>
                  </div>
                )}

                {testResult?.success && (
                  <div className="flex items-center gap-2 text-xs bg-green-50 text-green-700 rounded-lg px-4 py-2.5 animate-fade-in-up" style={{ animationDuration: "200ms" }}>
                    <CheckIcon className="w-3.5 h-3.5 shrink-0" />
                    <span>Connection successful — credentials are valid.</span>
                  </div>
                )}
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

      {/* Google Sheets Sync */}
      <div className="max-w-xl animate-fade-in-up" style={{ animationDelay: "300ms" }}>
        <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E3E8EF]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#F6F9FC] flex items-center justify-center">
                <SheetIcon className="w-4 h-4 text-[#34A853]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[#0A2540]">
                  Google Sheets Sync
                </h2>
                <p className="text-xs text-[#697386] mt-0.5">
                  Automatically append new cases to your Google Sheet
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {/* Setup Guide Toggle */}
            <button
              type="button"
              onClick={() => setShowGuide(!showGuide)}
              className="flex items-center gap-2 text-xs font-medium text-[#635BFF] hover:text-[#5851DB] transition-colors w-full"
            >
              <ChevronIcon className={`w-3.5 h-3.5 transition-transform duration-200 ${showGuide ? "rotate-90" : ""}`} />
              How to set up Google Sheets sync
            </button>

            {/* Setup Guide */}
            {showGuide && (
              <div className="space-y-3 animate-fade-in-up" style={{ animationDuration: "200ms" }}>
                {/* Step 1 */}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#635BFF] text-white flex items-center justify-center text-[11px] font-bold mt-0.5">1</div>
                  <div>
                    <p className="text-xs font-semibold text-[#0A2540]">Create a new Google Sheet</p>
                    <p className="text-[11px] text-[#697386] mt-0.5 leading-relaxed">
                      Go to <span className="font-medium text-[#425466]">sheets.google.com </span> and create a blank spreadsheet. Give it a name like &quot;My Cases&quot;.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#635BFF] text-white flex items-center justify-center text-[11px] font-bold mt-0.5">2</div>
                  <div>
                    <p className="text-xs font-semibold text-[#0A2540]">Share with the service account</p>
                    <p className="text-[11px] text-[#697386] mt-0.5 leading-relaxed">
                      Click <span className="font-medium text-[#425466]">Share</span> in the top right, then paste the service account email below and give it <span className="font-medium text-[#425466]">Editor</span> access.
                    </p>
                    {serviceAccountEmail && (
                      <div className="flex items-center gap-2 mt-2">
                        <code className="text-[11px] text-[#635BFF] bg-[#F6F9FC] px-2 py-1 rounded border border-[#E3E8EF] flex-1 truncate">
                          {serviceAccountEmail}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(serviceAccountEmail);
                            toast.success("Email copied to clipboard");
                          }}
                          className="text-[#697386] hover:text-[#0A2540] transition-colors shrink-0"
                          aria-label="Copy service account email"
                        >
                          <CopyIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#635BFF] text-white flex items-center justify-center text-[11px] font-bold mt-0.5">3</div>
                  <div>
                    <p className="text-xs font-semibold text-[#0A2540]">Copy the Sheet ID from the URL</p>
                    <p className="text-[11px] text-[#697386] mt-0.5 leading-relaxed">
                      Open your Google Sheet and look at the URL in your browser. The Sheet ID is the long string between <span className="font-medium text-[#425466]">/d/</span> and <span className="font-medium text-[#425466]">/edit</span>.
                    </p>
                    <div className="mt-2 bg-[#F6F9FC] rounded-lg px-3 py-2 border border-[#E3E8EF]">
                      <p className="text-[10px] text-[#697386] mb-1">Example URL:</p>
                      <p className="text-[11px] text-[#425466] break-all leading-relaxed font-mono">
                        docs.google.com/spreadsheets/d/<span className="text-[#635BFF] font-semibold bg-[#EBE9FE] px-0.5 rounded">1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms</span>/edit
                      </p>
                    </div>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#635BFF] text-white flex items-center justify-center text-[11px] font-bold mt-0.5">4</div>
                  <div>
                    <p className="text-xs font-semibold text-[#0A2540]">Paste the Sheet ID below and save</p>
                    <p className="text-[11px] text-[#697386] mt-0.5 leading-relaxed">
                      Paste the highlighted part into the field below, then click <span className="font-medium text-[#425466]">Save Sheet ID</span>. New cases will automatically sync after each crawl.
                    </p>
                  </div>
                </div>

                <div className="border-t border-[#E3E8EF] my-1" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="google-sheet-id" className="text-xs font-medium text-[#425466]">
                Google Sheet ID
              </Label>
              <Input
                id="google-sheet-id"
                type="text"
                placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                value={googleSheetId}
                onChange={(e) => setGoogleSheetId(e.target.value)}
                className="rounded-lg h-10 border-[#E3E8EF] focus:border-[#635BFF] font-mono text-xs"
              />
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                disabled={savingSheet || googleSheetId === savedSheetId}
                onClick={handleSaveSheetId}
                className="h-10 px-5 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] hover-glow"
              >
                {savingSheet ? "Saving..." : savedSheetId ? "Update Sheet ID" : "Save Sheet ID"}
              </Button>

              {savedSheetId && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={syncing}
                  onClick={handleSyncToSheet}
                  className="h-10 px-5 rounded-lg text-sm font-medium border-[#E3E8EF] text-[#425466] hover:border-[#34A853] hover:text-[#34A853] press-effect"
                >
                  {syncing ? (
                    <>
                      <span className="h-3.5 w-3.5 mr-2 animate-spin rounded-full border-2 border-[#34A853] border-t-transparent inline-block" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <SyncIcon className="w-3.5 h-3.5 mr-2" />
                      Sync Now
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 animate-fade-in" style={{ animationDuration: "200ms" }}>
          <div className="bg-white rounded-lg border border-[#E3E8EF] shadow-xl w-full max-w-sm mx-4 animate-scale-in">
            <div className="p-6">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center mb-4">
                <AlertIcon className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-base font-semibold text-[#0A2540] mb-1">
                Update password?
              </h3>
              <p className="text-sm text-[#697386] leading-relaxed">
                Are you sure you want to update your WifiBizz password? This will replace your current saved password.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#E3E8EF]">
              <Button
                variant="outline"
                className="h-9 px-4 rounded-lg text-sm border-[#E3E8EF] text-[#425466] press-effect"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                className="h-9 px-4 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] hover-glow"
                onClick={doSave}
              >
                Yes, update
              </Button>
            </div>
          </div>
        </div>
      )}
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

function WifiIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 20h.01" />
      <path d="M2 8.82a15 15 0 0 1 20 0" />
      <path d="M5 12.859a10 10 0 0 1 14 0" />
      <path d="M8.5 16.429a5 5 0 0 1 7 0" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function SheetIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M9 3v18" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function SyncIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
