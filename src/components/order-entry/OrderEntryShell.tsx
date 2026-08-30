"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  getDealerConnection,
  checkDealerConnection,
  requestDealerOtp,
  submitDealerOtp,
  cancelDealerOtp,
  checkDealerOtpAutoStatus,
  checkDealerOtpNow,
  disconnectDealerAccount,
  type DealerConnection,
} from "@/actions/dealer";
import { toast } from "sonner";
import LottieSpot from "./LottieSpot";

// "auto" = server is reading the OTP from Gmail in the background (tried for
// every Email-channel login; only actually succeeds if it lands in the
// mailbox the server has access to). Manual entry via "otp" is always one
// click away from "auto", and is what SMS-channel logins go straight to.
type Step = "form" | "auto" | "otp";

// The session clock starts at 60:00. Re-validate against the portal once it
// drops to this mark, which resets it to a full hour — so the session is kept
// alive rather than silently lapsing mid-order.
const SESSION_REFRESH_AT_SECONDS = 50 * 60;

// Floor between auto-refreshes. Normally inert (they land ~10 min apart), but
// the trigger reads a countdown derived from the BROWSER clock against an
// expiry set by the SERVER clock. If those disagree enough, the countdown can
// sit below the threshold even right after a refresh — this stops that
// becoming a hot loop of real portal hits.
const SESSION_REFRESH_MIN_GAP_MS = 5 * 60 * 1000;

const TABS = [
  { href: "/dashboard/order-entry/new-order", label: "New Order" },
  // "Orders", not "Drafts": this tab has always listed every order — drafts,
  // in-flight runs and orders the portal has already numbered — and calling it
  // Drafts made the submitted ones look like they belonged somewhere else. The
  // ROUTE stays /drafts so existing links and bookmarks keep working.
  { href: "/dashboard/order-entry/drafts", label: "Orders" },
  { href: "/dashboard/order-entry/plan-details", label: "Plan Settings" },
];

export default function OrderEntryShell({
  children,
  isSuperAdmin = false,
}: {
  children: React.ReactNode;
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  // Wide tables (drafts, catalogue) get the full width; the order FORM stays
  // narrow so its fields don't stretch into an unreadable line length.
  const isWide = pathname?.endsWith("/drafts") || pathname?.endsWith("/plan-details");

  const [loading, setLoading] = useState(true);
  // Set when the initial load itself failed (server action threw). Replaces the
  // spinner with a retryable message rather than spinning indefinitely.
  const [loadError, setLoadError] = useState("");
  const [connection, setConnection] = useState<DealerConnection | null>(null);

  // Step 1 fields
  const [staffCode, setStaffCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Inline "staff code or password is wrong" banner on the credentials form.
  const [credentialsError, setCredentialsError] = useState("");
  const [channel, setChannel] = useState<"Email" | "SMS">("Email");
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [showForwardHelp, setShowForwardHelp] = useState(false);

  // Two-step state
  const [step, setStep] = useState<Step>("form");
  // Explanation shown on the manual OTP step when the portal accepted the
  // request but sent no code at all (see reason "otp_not_sent").
  const [otpNotSent, setOtpNotSent] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);

  // Live session-health check state
  const lastAutoRefreshRef = useRef(0);
  const [checking, setChecking] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const runStatusCheck = useCallback(async () => {
    setChecking(true);
    // Same reason as loadConnection: a thrown action would otherwise leave this
    // stuck on "Verifying connection…" with no way out. The stored connection
    // stays on screen — a failed re-check is not evidence the session is gone.
    try {
      const result = await checkDealerConnection();
      if (result.success) {
        setConnection(result.data);
        if (result.data?.staffCode) setStaffCode(result.data.staffCode);
        if (result.data?.registeredEmail) setRegisteredEmail(result.data.registeredEmail);
        setSessionExpired(!!result.data && !result.data.connected);
      }
    } catch {
      // Leave the last known state as-is; the countdown still governs expiry.
    } finally {
      setChecking(false);
    }
  }, []);

  // The portal rejected the staff code / password. No OTP can rescue that
  // attempt (the server has already closed its browser), so abandon the OTP
  // step entirely and put the user back on the credentials form with the
  // reason shown inline — rather than leaving them typing codes into a box
  // that can never accept one.
  const failToCredentials = useCallback((message: string) => {
    setStep("form");
    setPendingId(null);
    setOtp("");
    setPassword(""); // it was wrong — make them retype it, don't hide that
    setSecondsLeft(0);
    setCredentialsError(message);
    toast.error(message);
  }, []);

  const loadConnection = useCallback(async () => {
    setLoadError("");
    // A server action REJECTS on a 500 — it does not resolve with success:false.
    // Without this catch the `await` below never returns, `setLoading(false)`
    // never runs, and the card spins on "Loading…" forever with nothing on
    // screen saying why. That is exactly what a missing prod migration looked
    // like: an indefinite silent hang instead of a reportable error.
    let result: Awaited<ReturnType<typeof getDealerConnection>>;
    try {
      result = await getDealerConnection();
    } catch {
      setLoading(false);
      setLoadError(
        "Couldn't load your dealer connection. Please retry — if it keeps failing, contact support."
      );
      return;
    }
    if (result.success) {
      setConnection(result.data);
      if (result.data?.staffCode) setStaffCode(result.data.staffCode);
      if (result.data?.registeredEmail) setRegisteredEmail(result.data.registeredEmail);
      setSessionExpired(!!result.data && !result.data.connected);
    }
    setLoading(false);
    // Verify against the portal on load so the badge reflects REALITY — the
    // stored clock is only a guess and can show "Connected" after the portal
    // session has already expired. (Affordable now: droplet is 2GB with bounded
    // browser teardown.)
    if (result.success && result.data) {
      runStatusCheck();
    }
  }, [runStatusCheck]);

  useEffect(() => {
    // loadConnection awaits before any setState, so this isn't a synchronous
    // cascade — the lint rule can't see through the async boundary.
    loadConnection();
  }, [loadConnection]);

  // Poll while the server is auto-reading the OTP from Gmail. Stops itself on
  // any terminal result; "timeout"/"error"/"not_applicable" fall back to the
  // manual OTP form rather than failing the login outright.
  useEffect(() => {
    if (step !== "auto" || !pendingId) return;
    let cancelled = false;

    async function poll() {
      const result = await checkDealerOtpAutoStatus(pendingId!);
      if (cancelled) return;

      if (!result.success || !result.data) return; // transient — try again next tick

      switch (result.data.status) {
        case "completed":
          toast.success("Dealer account connected automatically.");
          setPassword("");
          setOtp("");
          setPendingId(null);
          setStep("form");
          setSessionExpired(false);
          await loadConnection();
          break;
        case "error":
          // A rejected password surfaces here too when auto-read completed the
          // login for the user — same outcome as the manual path.
          if (result.data.reason === "bad_credentials") {
            failToCredentials(
              result.data.message || "Your staff code or password is incorrect."
            );
            break;
          }
          if (result.data.reason === "otp_not_sent") {
            // Still drop to manual entry rather than abandoning the login: we
            // are reporting a likely cause, not a certainty, and a late code
            // can still be typed if one turns up.
            setOtpNotSent(
              result.data.message ||
                "The portal accepted the request but sent no code — it is likely rate-limiting OTP requests. Wait a while before asking for another."
            );
            setStep("otp");
            break;
          }
        // falls through — any other error means "couldn't auto-read", so offer
        // the manual OTP form.
        case "timeout":
        case "not_applicable":
        case "not_found":
          if (result.data.status !== "not_applicable") {
            toast.message(
              result.data.message ||
                "Couldn't read the OTP automatically — enter it manually."
            );
          }
          setStep("otp");
          break;
        // "pending" — keep polling
      }
    }

    const t = setInterval(poll, 2500);
    poll();
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [step, pendingId, loadConnection, failToCredentials]);

  // OTP-window countdown. On expiry, drop back to step 1.
  useEffect(() => {
    if ((step !== "otp" && step !== "auto") || secondsLeft <= 0) return;
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

  // Auto-refresh the session at the 50-minute mark. A successful check resets
  // the clock to a full hour, which takes it back out of this window.
  //   - `checking` guard: don't stack a second check on an in-flight one.
  //   - `> 0` guard: a FAILED check clears the expiry (countdown 0), which
  //     would otherwise still satisfy `<= threshold` and spin in a retry loop.
  //   - min-gap guard: backstop against clock skew (see the constant).
  useEffect(() => {
    if (!connection?.connected || checking) return;
    if (sessionSecondsLeft <= 0 || sessionSecondsLeft > SESSION_REFRESH_AT_SECONDS) return;
    if (Date.now() - lastAutoRefreshRef.current < SESSION_REFRESH_MIN_GAP_MS) return;
    lastAutoRefreshRef.current = Date.now();
    // runStatusCheck flips `checking` synchronously; that's the intended
    // guard above, not an unintended render cascade.
    runStatusCheck();
  }, [connection?.connected, checking, sessionSecondsLeft, runStatusCheck]);

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
    setCredentialsError("");
    setOtpNotSent(""); // a fresh request re-opens the question
    const result = await requestDealerOtp(
      staffCode.trim(),
      password,
      channel,
      channel === "Email" ? registeredEmail.trim() : undefined
    );
    setSending(false);
    if (result.success && result.pendingId) {
      setPendingId(result.pendingId);
      setSecondsLeft(result.expiresIn ?? 240);
      setOtp("");
      if (result.autoOtp) {
        setStep("auto");
        toast.success(`OTP sent via ${channel}. Reading it automatically…`);
      } else {
        setStep("otp");
        toast.success(`OTP sent via ${channel}. Enter the code you received.`);
      }
    } else {
      // The portal validates the staff code / password at this step, so a
      // rejection here never reaches the OTP screen at all — keep the user on
      // the form and say why.
      const message = result.error ?? "Failed to send OTP";
      setCredentialsError(message);
      toast.error(message);
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
      setSessionExpired(false);
      await loadConnection();
    } else if (result.badCredentials) {
      failToCredentials(result.error ?? "Your staff code or password is incorrect.");
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

  async function handleDisconnect() {
    setDisconnecting(true);
    await disconnectDealerAccount();
    setDisconnecting(false);
    toast.success("Dealer account disconnected.");
    setPassword("");
    setStep("form");
    await loadConnection();
  }

  async function handleCheckNow() {
    if (!pendingId) return;
    setCheckingNow(true);
    const result = await checkDealerOtpNow(pendingId);
    setCheckingNow(false);
    if (result.success) {
      toast.success("Dealer account connected.");
      setPassword("");
      setOtp("");
      setPendingId(null);
      setStep("form");
      setSessionExpired(false);
      await loadConnection();
    } else if (result.connecting) {
      // Already found and mid-login — stay on the auto step; its poll will
      // report success shortly.
      setStep("auto");
      toast.message("Code found — connecting…");
    } else if (result.notFound) {
      toast.message("No OTP email found yet — check your inbox and try again in a few seconds.");
    } else {
      toast.error(result.error ?? "Couldn't check for the OTP right now.");
    }
  }

  // Green "Connected" only while BOTH the live/stored state says connected AND
  // the countdown hasn't elapsed — so it can never show "Connected" next to an
  // expired clock. `checking` keeps it shown (as "Verifying…") during a check.
  const isConnected =
    connection?.connected && (checking || sessionSecondsLeft > 0);

  // One warning as the session enters its last five minutes — expiring silently
  // mid-form is how an agent loses a filled order. Re-arms after a reconnect.
  const expiryWarnedRef = useRef(false);
  useEffect(() => {
    if (!isConnected || sessionSecondsLeft <= 0) {
      expiryWarnedRef.current = false;
      return;
    }
    if (sessionSecondsLeft <= 300 && !expiryWarnedRef.current) {
      expiryWarnedRef.current = true;
      toast.warning(
        "Your dealer session expires in under 5 minutes — reconnect soon to keep submitting.",
      );
    }
  }, [isConnected, sessionSecondsLeft]);
  // Superadmins may browse the drafts view without a live portal session
  // (view-only — submitting an order still needs a real connection).
  const canView = isConnected || isSuperAdmin;
  const viewOnly = isSuperAdmin && !isConnected;

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
        {!loading && !loadError && isConnected ? (
          /* ---------- Connected: a slim status strip instead of the card.
             Session plumbing matters when it is broken; once connected the
             agent's work is below, so ~300px of card collapses to one line. */
          <div className="flex items-center gap-3 rounded-lg border border-[#E3E8EF] bg-white px-4 py-2.5">
            {checking ? (
              <span
                className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent"
                aria-hidden="true"
              />
            ) : (
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${
                    sessionSecondsLeft <= 300 ? "bg-amber-500" : "bg-[#0E9F6E]"
                  }`}
                />
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    sessionSecondsLeft <= 300 ? "bg-amber-500" : "bg-[#0E9F6E]"
                  }`}
                />
              </span>
            )}
            <span className="truncate text-sm text-[#0A2540]">
              {checking ? (
                "Verifying connection…"
              ) : (
                <>
                  Connected as{" "}
                  <span className="font-semibold tabular-nums">
                    {connection?.staffCode || "—"}
                  </span>
                </>
              )}
            </span>
            <span
              className="hidden h-4 w-px shrink-0 bg-[#E3E8EF] sm:inline-block"
              aria-hidden="true"
            />
            <span
              className={`hidden items-center gap-1.5 text-xs tabular-nums sm:inline-flex ${
                sessionSecondsLeft <= 60
                  ? "font-semibold text-[#DF1B41]"
                  : sessionSecondsLeft <= 300
                    ? "font-semibold text-amber-600"
                    : "text-[#697386]"
              }`}
              title="Session expires in"
            >
              <ClockIcon className="h-3.5 w-3.5" />
              {sessionSecondsLeft > 0 ? fmtCountdown(sessionSecondsLeft) : "verifying…"}
            </span>
            <button
              type="button"
              disabled={disconnecting}
              onClick={handleDisconnect}
              className="ml-auto shrink-0 cursor-pointer text-xs font-medium text-[#697386] transition-colors duration-150 hover:text-[#DF1B41] disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : (
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
            {loading ? (
              /* ---------- Initial load ---------- */
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
                <p className="text-sm text-[#697386]">Loading…</p>
              </div>
            ) : loadError ? (
              /* ---------- Initial load failed ---------- */
              <div className="space-y-4">
                <div className="text-sm bg-red-50 text-[#DF1B41] rounded-lg px-4 py-3">
                  {loadError}
                </div>
                <Button
                  onClick={() => {
                    setLoading(true);
                    loadConnection();
                  }}
                  className="w-full"
                >
                  Retry
                </Button>
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
                {credentialsError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 text-xs bg-red-50 text-[#B42318] rounded-lg px-4 py-2.5"
                  >
                    <span aria-hidden="true" className="mt-0.5 shrink-0 font-semibold">
                      !
                    </span>
                    <span>{credentialsError}</span>
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
                    <option value="Email">Email / 邮箱</option>
                    <option value="SMS">SMS</option>
                  </select>
                </div>

                {channel === "Email" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="registered-email" className="text-xs font-medium text-[#425466]">
                      Registered Email
                    </Label>
                    <Input
                      id="registered-email"
                      type="email"
                      placeholder="e.g. nexion.eform@gmail.com"
                      value={registeredEmail}
                      onChange={(e) => setRegisteredEmail(e.target.value)}
                      required
                      className="rounded-lg h-10 border-[#E3E8EF] focus:border-[#635BFF]"
                    />
                    <p className="text-[11px] text-[#697386]">
                      The email address registered on this dealer account — needed
                      so BizzFlow can read the OTP automatically instead of you
                      typing it in.{" "}
                      <button
                        type="button"
                        onClick={() => setShowForwardHelp((v) => !v)}
                        className="text-[#635BFF] font-medium hover:underline"
                      >
                        {showForwardHelp ? "Hide instructions" : "How to set this up"}
                      </button>
                    </p>
                    {showForwardHelp && (
                      <div className="text-[11px] text-[#425466] bg-[#F6F9FC] rounded-lg px-3 py-2.5 space-y-1.5 leading-relaxed">
                        <p>
                          In the Gmail account above, go to{" "}
                          <span className="font-medium">
                            Settings → See all settings → Forwarding and POP/IMAP
                          </span>{" "}
                          → <span className="font-medium">Add a forwarding address</span> →
                          enter{" "}
                          <span className="font-mono font-medium">
                            jobhunters.ai.pro@gmail.com
                          </span>
                          .
                        </p>
                        <p>
                          Gmail will ask us to confirm on our end — once we do, enable
                          forwarding for future messages. After that, OTP emails sent to
                          this address arrive automatically and BizzFlow reads them for
                          you.
                        </p>
                        <p className="text-[#697386]">
                          Without forwarding set up, auto-read simply won&apos;t find
                          anything and you&apos;ll fall back to entering the code
                          manually — nothing breaks either way.
                        </p>
                      </div>
                    )}
                  </div>
                )}

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
                </div>
              </form>
            ) : step === "auto" ? (
              /* ---------- Step 2 (auto): reading OTP from Gmail ---------- */
              <div className="space-y-4">
                <div className="flex items-center gap-2.5 text-xs bg-[#EBE9FE] text-[#5851DB] rounded-lg px-4 py-2.5">
                  <LottieSpot
                    name="otp-reading"
                    size={30}
                    className="-my-1"
                    fallback={
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#5851DB] border-t-transparent inline-block shrink-0" />
                    }
                  />
                  <span>
                    Reading the OTP from email automatically. Expires in{" "}
                    <span className="font-semibold tabular-nums">
                      {Math.floor(secondsLeft / 60)}:
                      {String(secondsLeft % 60).padStart(2, "0")}
                    </span>
                  </span>
                </div>
              </div>
            ) : (
              /* ---------- Step 2 (manual): OTP ---------- */
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="flex items-center gap-2 text-xs bg-[#EBE9FE] text-[#5851DB] rounded-lg px-4 py-2.5">
                  <ClockIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {/* Don't claim the code was sent when we have just
                        established that it wasn't — that is the same false
                        confirmation this whole check exists to remove. */}
                    {otpNotSent ? "This login window" : `OTP sent via ${channel}`}. Expires in{" "}
                    <span className="font-semibold tabular-nums">
                      {Math.floor(secondsLeft / 60)}:
                      {String(secondsLeft % 60).padStart(2, "0")}
                    </span>
                  </span>
                </div>

                {/* The portal took the request and sent nothing. Persistent,
                    not a toast: the instruction is to WAIT before asking
                    again, and a toast is gone before that can register. */}
                {otpNotSent && (
                  <div className="text-xs bg-amber-50 text-amber-900 rounded-lg px-4 py-3">
                    {otpNotSent}
                  </div>
                )}

                {channel === "Email" && (
                  <div className="flex items-center gap-2 text-xs bg-[#F6F9FC] text-[#425466] rounded-lg px-4 py-2.5">
                    <span>Already see the code in your inbox?</span>
                    <button
                      type="button"
                      disabled={checkingNow}
                      onClick={handleCheckNow}
                      className="text-[#635BFF] font-medium hover:underline disabled:opacity-50"
                    >
                      {checkingNow ? "Checking…" : "Check email now"}
                    </button>
                  </div>
                )}

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
        )}
      </div>

      {/* `{children}` must stay mounted regardless of connection state — an App
          Router layout that conditionally drops its children remounts the route
          segment and throws "Rendered more hooks". So gate visibility with CSS,
          never by unmounting. */}
      <div
        className={`${canView ? (isWide ? "w-full" : "max-w-4xl") : "hidden"} animate-fade-in-up`}
        style={{ animationDelay: "300ms" }}
      >
        {viewOnly && (
          <div className="flex items-start gap-2 text-xs bg-[#F6F9FC] text-[#425466] rounded-lg px-4 py-2.5 mb-4 border border-[#E3E8EF]">
            <ClockIcon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#635BFF]" />
            <span>
              Superadmin view — browsing all drafts without a portal session.
              Connect a dealer account above to submit orders.
            </span>
          </div>
        )}
        <div className="flex gap-1 border-b border-[#E3E8EF] mb-5">
          {TABS.map((tab) => {
            const active = pathname?.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? "border-[#635BFF] text-[#635BFF]"
                    : "border-transparent text-[#697386] hover:text-[#0A2540]"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
        {children}
      </div>
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
