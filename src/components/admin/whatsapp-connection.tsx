"use client";

import { useCallback, useEffect, useState } from "react";
import { getWhatsappConnection, whatsappConnectionAction } from "@/actions/whatsapp";
import type { GatewayState } from "@/lib/whatsapp-send";
import { toast } from "@/lib/toast";

/** Fast while someone may be scanning; slow once linked. */
const POLL_LINKING_MS = 3_000;
const POLL_LINKED_MS = 30_000;

/**
 * The linked WhatsApp number: a QR to scan from the phone's Linked devices, or
 * the connected number with a way to unlink it.
 */
export function WhatsappConnection({ onConnectedChange }: { onConnectedChange: (connected: boolean) => void }) {
  const [state, setState] = useState<GatewayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const res = await getWhatsappConnection();
    if (res.success) {
      setState(res.data);
      setError(null);
      onConnectedChange(res.data.status === "open");
    } else {
      setError(res.error);
      onConnectedChange(false);
    }
  }, [onConnectedChange]);

  const linked = state?.status === "open";
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), linked ? POLL_LINKED_MS : POLL_LINKING_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load, linked]);

  async function act(action: "connect" | "logout") {
    setBusy(true);
    const res = await whatsappConnectionAction(action);
    setBusy(false);
    setConfirming(false);
    if (!res.success) toast.error(res.error);
    else if (action === "logout") toast.success("WhatsApp number unlinked.");
    await load();
  }

  if (error) {
    return (
      <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {error}
      </div>
    );
  }
  if (!state) {
    return <p role="status" className="text-sm text-ink-muted">Checking the WhatsApp connection…</p>;
  }

  if (state.status === "open") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm text-ink">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
          Connected{state.me ? <> as <span className="font-mono">+{state.me}</span></> : null}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-sm text-ink-muted">Unlink this number?</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("logout")}
                className="min-h-11 rounded-lg bg-red-600 px-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? "Unlinking…" : "Yes, unlink"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="min-h-11 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-wash"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="min-h-11 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-wash"
            >
              Disconnect
            </button>
          )}
        </span>
      </div>
    );
  }

  const expired = state.status === "qr_expired" || state.status === "logged_out";
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-white p-4 sm:flex-row">
      <div className="flex size-56 shrink-0 items-center justify-center self-center rounded-lg border border-line bg-white">
        {state.status === "qr" && state.qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL that changes every ~20 s
          <img src={state.qr} alt="WhatsApp QR code to link this number" className="size-52" />
        ) : expired ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("connect")}
            className="min-h-11 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Starting…" : "Show new QR"}
          </button>
        ) : (
          <p role="status" className="px-4 text-center text-sm text-ink-muted">
            {state.status === "reconnecting" ? "Reconnecting to WhatsApp…" : "Starting WhatsApp…"}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-2 text-sm text-ink">
        <h2 className="text-base font-semibold">Link a WhatsApp number</h2>
        <ol className="list-decimal space-y-1 pl-5 text-ink-muted">
          <li>Open WhatsApp on the business phone.</li>
          <li>Go to <span className="text-ink">Settings → Linked devices → Link a device</span>.</li>
          <li>Scan this code. It refreshes every 20 seconds or so.</li>
        </ol>
        {expired && (
          <p className="text-ink-muted">
            {state.status === "logged_out" ? "The number was unlinked." : "The QR expired before it was scanned."} Press
            Show new QR to try again.
          </p>
        )}
        <p className="text-xs text-amber-700">
          This links the number the way WhatsApp Web does, not through Meta&apos;s official API. WhatsApp can ban
          numbers it sees as automated, so send at a human pace.
        </p>
      </div>
    </div>
  );
}
