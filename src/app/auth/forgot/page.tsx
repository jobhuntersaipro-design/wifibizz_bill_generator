"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/actions/account";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/AuthShell";

/**
 * Ask for a reset link. The reply is IDENTICAL whether the address exists or
 * not — the server enforces that; this page just never pretends to know more.
 */
export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await requestPasswordReset(email);
    setBusy(false);
    setSent(res.message);
  }

  return (
    <AuthShell title="Forgot your password?" subtitle="We'll mail you a link to choose a new one.">
      {sent ? (
        <div className="space-y-4">
          <p className="rounded-lg border border-line bg-wash px-4 py-3 text-sm text-ink-soft">
            {sent}
          </p>
          <Link href="/auth/signin" className="text-sm text-brand hover:underline">
            ← Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-xs font-medium text-ink-soft">Email</label>
            <Input id="email" type="email" required autoComplete="email" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <Button type="submit" disabled={busy}
            className="w-full h-10 rounded-lg text-sm font-semibold bg-brand hover:bg-ink">
            {busy ? "Sending…" : "Send reset link"}
          </Button>
          <Link href="/auth/signin" className="block text-center text-sm text-brand hover:underline">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
