"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { resetPassword } from "@/actions/account";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/AuthShell";

/**
 * Choose a new password from a mailed link. On success it lands on SIGN-IN
 * with a note rather than logging in — auto-login from an e-mail link is a
 * phishing-shaped habit (decided with the user, 2026-08-31).
 */
function ResetInner() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) { setError("The passwords don't match."); return; }
    setBusy(true);
    const res = await resetPassword(token, next);
    setBusy(false);
    if (res.success) {
      toast.success("Password changed — sign in with the new one.");
      router.push("/auth/signin");
    } else {
      setError(res.error ?? "Could not reset the password.");
    }
  }

  return (
    <AuthShell title="Choose a new password" subtitle="The link works once and expires after 30 minutes.">
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <p className="rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B42318]">
            {error}{" "}
            <Link href="/auth/forgot" className="font-medium underline">Request a new link</Link>
          </p>
        )}
        <div className="space-y-1.5">
          <label htmlFor="pw" className="text-xs font-medium text-[#425466]">New password</label>
          <Input id="pw" type="password" required minLength={8} autoComplete="new-password" autoFocus
            value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="pw2" className="text-xs font-medium text-[#425466]">Repeat it</label>
          <Input id="pw2" type="password" required minLength={8} autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy}
          className="w-full h-10 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540]">
          {busy ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}
