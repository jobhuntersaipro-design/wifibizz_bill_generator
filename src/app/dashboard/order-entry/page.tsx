"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  getDealerConnection,
  checkDealerConnection,
  requestDealerOtp,
  submitDealerOtp,
  cancelDealerOtp,
  type DealerConnection,
} from "@/actions/dealer";
import { toast } from "sonner";
import { OrderForm } from "@/components/order-entry/OrderForm";
import { OrdersList } from "@/components/order-entry/OrdersList";

type Step = "form" | "otp";

export default function OrderEntryPage() {
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<DealerConnection | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  // Step 1 fields
  const [staffCode, setStaffCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [channel, setChannel] = useState<"Email" | "SMS">("Email");

  // Two-step state
  const [step, setStep] = useState<Step>("form");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Live session-health check state
  const [checking, setChecking] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [orderTab, setOrderTab] = useState<"new" | "drafts">("new");

  const runStatusCheck = useCallback(async () => {
    setChecking(true);
    const result = await checkDealerConnection();
    if (result.success) {
      setConnection(result.data);
      if (result.data?.staffCode) setStaffCode(result.data.staffCode);
      // A stored account that no longer validates = timed out.
      setSessionExpired(!!result.data && !result.data.connected);
    }
    setChecking(false);
  }, []);

  const loadConnection = useCallback(async () => {
    const result = await getDealerConnection();
    if (result.success) {
      setConnection(result.data);
      if (result.data?.staffCode) setStaffCode(result.data.staffCode);
    }
    setLoading(false);
    // If the DB thinks we have a session, confirm it's really still alive.
    if (result.success && result.data) {
      runStatusCheck();
    }
  }, [runStatusCheck]);

  useEffect(() => {
    loadConnection();
  }, [loadConnection]);

  // OTP-window countdown. On expiry, drop back to step 1.
  useEffect(() => {
    if (step !== "otp" || secondsLeft <= 0) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          setStep("form");
          setPendingId(null);
          toast.error("OTP window expired — request a new code.");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [step, secondsLeft]);

  // Tick every second while connected so the session countdown updates.
  useEffect(() => {
    if (!connection?.connected || !connection?.sessionExpiresAt) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [connection?.connected, connection?.sessionExpiresAt]);

  const sessionSecondsLeft = connection?.sessionExpiresAt
    ? Math.max(0, Math.floor((new Date(connection.sessionExpiresAt).getTime() - nowTs) / 1000))
    : 0;

  function fmtCountdown(secs: number) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    const result = await requestDealerOtp(staffCode.trim(), password, channel);
    setSending(false);
    if (result.success && result.pendingId) {
      setPendingId(result.pendingId);
      setSecondsLeft(result.expiresIn ?? 240);
      setStep("otp");
      setOtp("");
      toast.success(`OTP sent via ${channel}. Enter the code you received.`);
    } else {
      toast.error(result.error ?? "Failed to send OTP");
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingId) return;
    setVerifying(true);
    const result = await submitDealerOtp(pendingId, otp.trim());
    setVerifying(false);
    if (result.success) {
      toast.success("Dealer account connected.");
      setPassword("");
      setOtp("");
      setPendingId(null);
      setStep("form");
      setReconnecting(false);
      setSessionExpired(false);
      await loadConnection();
    } else {
      toast.error(result.error ?? "OTP verification failed");
    }
  }

  async function handleCancel() {
    if (pendingId) await cancelDealerOtp(pendingId);
    setPendingId(null);
    setStep("form");
    setOtp("");
    setPassword("");
  }

  const isConnected = connection?.connected && !reconnecting;

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-[#0A2540]">Order Entry</h1>
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
        <h1 className="text-2xl font-semibold text-[#0A2540]">Order Entry</h1>
        <p className="text-sm text-[#697386] mt-1">
          Connect your Unifi dealer account to key in broadband orders.
        </p>
      </div>

      <div className="max-w-xl animate-fade-in-up" style={{ animationDelay: "200ms" }}>
        <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden">
          {/* Card header */}
          <div className="px-6 py-4 border-b border-[#E3E8EF]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#F6F9FC] flex items-center justify-center">
                <PortalIcon className="w-4 h-4 text-[#635BFF]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[#0A2540]">
                  Connect Unifi Dealer Account
                </h2>
                <p className="text-xs text-[#697386] mt-0.5">
                  Log in with your own staff code, password, and OTP.
                </p>
              </div>
            </div>
          </div>

          <div className="p-6">
            {isConnected ? (
              /* ---------- Connected state ---------- */
              <div className="space-y-4">
                {checking ? (
                  <div className="flex items-center gap-2 text-sm bg-[#F6F9FC] text-[#425466] rounded-lg px-4 py-3">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent inline-block" />
                    <span>Verifying connection…</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm bg-green-50 text-green-700 rounded-lg px-4 py-3">
                    <CheckIcon className="w-4 h-4 shrink-0" />
                    <span>
                      Connected as{" "}
                      <span className="font-semibold tabular-nums">
                        {connection?.staffCode || "—"}
                      </span>
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-[#F6F9FC] rounded-lg px-4 py-3">
                    <p className="text-[#697386]">Last connected</p>
                    <p className="text-[#0A2540] font-medium mt-0.5">
                      {connection?.lastConnectedAt
                        ? new Date(connection.lastConnectedAt).toLocaleString()
                        : "—"}
                    </p>
                  </div>
                  <div className="bg-[#F6F9FC] rounded-lg px-4 py-3">
                    <p className="text-[#697386]">Session expires in</p>
                    <p className={`font-semibold mt-0.5 tabular-nums ${sessionSecondsLeft <= 60 ? "text-[#DF1B41]" : "text-[#0A2540]"}`}>
                      {sessionSecondsLeft > 0 ? fmtCountdown(sessionSecondsLeft) : "expired"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={checking}
                    onClick={runStatusCheck}
                    className="h-10 px-5 rounded-lg text-sm font-medium border-[#E3E8EF] text-[#425466] hover:border-[#635BFF] hover:text-[#635BFF] press-effect"
                  >
                    {checking ? "Checking…" : "Check connection"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setReconnecting(true);
                      setStep("form");
                      setPassword("");
                    }}
                    className="h-10 px-5 rounded-lg text-sm font-medium border-[#E3E8EF] text-[#425466] hover:border-[#635BFF] hover:text-[#635BFF] press-effect"
                  >
                    Reconnect
                  </Button>
                </div>
              </div>
            ) : step === "form" ? (
              /* ---------- Step 1: staff code + password + channel ---------- */
              <form onSubmit={handleSendOtp} className="space-y-4">
                {sessionExpired && (
                  <div className="flex items-start gap-2 text-xs bg-amber-50 text-amber-700 rounded-lg px-4 py-2.5">
                    <ClockIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      Your dealer session timed out. Reconnect to continue keying
                      orders.
                    </span>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="staff-code" className="text-xs font-medium text-[#425466]">
                    Staff Code
                  </Label>
                  <Input
                    id="staff-code"
                    type="text"
                    placeholder="e.g. TMRS00517"
                    value={staffCode}
                    onChange={(e) => setStaffCode(e.target.value)}
                    required
                    className="rounded-lg h-10 border-[#E3E8EF] focus:border-[#635BFF]"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="dealer-password" className="text-xs font-medium text-[#425466]">
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="dealer-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your dealer portal password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="rounded-lg h-10 pr-10 border-[#E3E8EF] focus:border-[#635BFF]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#697386] hover:text-[#0A2540] transition-colors"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-[#697386]">
                    Your password is used once to log in and is never stored.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="otp-channel" className="text-xs font-medium text-[#425466]">
                    Send OTP via
                  </Label>
                  <select
                    id="otp-channel"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as "Email" | "SMS")}
                    className="w-full rounded-lg h-10 px-3 border border-[#E3E8EF] bg-white text-sm text-[#0A2540] focus:border-[#635BFF] focus:outline-none"
                  >
                    <option value="Email">Email</option>
                    <option value="SMS">SMS</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    disabled={sending}
                    className="h-10 px-5 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] hover-glow"
                  >
                    {sending ? (
                      <>
                        <span className="h-3.5 w-3.5 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent inline-block" />
                        Sending OTP...
                      </>
                    ) : (
                      "Send OTP"
                    )}
                  </Button>
                  {reconnecting && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setReconnecting(false);
                        setPassword("");
                      }}
                      className="h-10 px-5 rounded-lg text-sm font-medium border-[#E3E8EF] text-[#425466] press-effect"
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            ) : (
              /* ---------- Step 2: OTP ---------- */
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="flex items-center gap-2 text-xs bg-[#EBE9FE] text-[#5851DB] rounded-lg px-4 py-2.5">
                  <ClockIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    OTP sent via {channel}. Expires in{" "}
                    <span className="font-semibold tabular-nums">
                      {Math.floor(secondsLeft / 60)}:
                      {String(secondsLeft % 60).padStart(2, "0")}
                    </span>
                  </span>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="otp" className="text-xs font-medium text-[#425466]">
                    Enter OTP
                  </Label>
                  <Input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6-digit code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    required
                    autoFocus
                    className="rounded-lg h-10 border-[#E3E8EF] focus:border-[#635BFF] tracking-[0.3em] font-mono"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    disabled={verifying}
                    className="h-10 px-5 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] hover-glow"
                  >
                    {verifying ? (
                      <>
                        <span className="h-3.5 w-3.5 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent inline-block" />
                        Verifying...
                      </>
                    ) : (
                      "Verify & Connect"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    className="h-10 px-5 rounded-lg text-sm font-medium border-[#E3E8EF] text-[#425466] press-effect"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>

      </div>

      {isConnected && (
        <div className="max-w-4xl animate-fade-in-up" style={{ animationDelay: "300ms" }}>
          <div className="flex gap-1 border-b border-[#E3E8EF] mb-5">
            <button
              type="button"
              onClick={() => setOrderTab("new")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                orderTab === "new" ? "border-[#635BFF] text-[#635BFF]" : "border-transparent text-[#697386] hover:text-[#0A2540]"
              }`}
            >
              New Order
            </button>
            <button
              type="button"
              onClick={() => setOrderTab("drafts")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                orderTab === "drafts" ? "border-[#635BFF] text-[#635BFF]" : "border-transparent text-[#697386] hover:text-[#0A2540]"
              }`}
            >
              Drafts
            </button>
          </div>
          {orderTab === "new" ? <OrderForm /> : <OrdersList />}
        </div>
      )}
    </div>
  );
}

function PortalIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="m9 16 3-3 3 3" />
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

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}
