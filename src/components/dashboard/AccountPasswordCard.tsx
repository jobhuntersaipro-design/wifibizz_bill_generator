"use client";

import { useState } from "react";
import { toast } from "sonner";
import { changePassword } from "@/actions/account";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * Change the LOGIN password — the first self-service the login has ever had.
 * The server re-checks everything; this form is convenience, not enforcement.
 */
export function AccountPasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      toast.error("The new passwords don't match.");
      return;
    }
    setSaving(true);
    const res = await changePassword(current, next);
    setSaving(false);
    if (res.success) {
      toast.success("Password changed.");
      setCurrent(""); setNext(""); setConfirm("");
    } else {
      toast.error(res.error ?? "Could not change the password.");
    }
  }

  return (
    <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden">
      <div className="px-6 py-4 border-b border-[#E3E8EF]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#F6F9FC] flex items-center justify-center">
            <LockIcon className="w-4 h-4 text-[#635BFF]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#0A2540]">Account</h2>
            <p className="text-xs text-[#697386] mt-0.5">
              Change the password you sign in to BizzFlow with.
            </p>
          </div>
        </div>
      </div>
      <form onSubmit={submit} className="p-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pw-current" className="text-xs font-medium text-[#425466]">Current password</Label>
          <Input id="pw-current" type="password" autoComplete="current-password" required
            value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pw-next" className="text-xs font-medium text-[#425466]">New password</Label>
            <Input id="pw-next" type="password" autoComplete="new-password" required minLength={8}
              value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-confirm" className="text-xs font-medium text-[#425466]">Repeat it</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" required minLength={8}
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>
        <Button type="submit" disabled={saving}
          className="h-10 px-5 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540]">
          {saving ? "Changing…" : "Change password"}
        </Button>
      </form>
    </div>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
