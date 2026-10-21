"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { formatKualaLumpur } from "@/lib/whatsapp-webhook";
import type { WhatsappEventView } from "@/lib/whatsapp-events";
import { pollWhileVisible } from "@/lib/poll";

const POLL_MS = 8_000;

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2);
  } catch {
    return raw;
  }
}

function cell(value: string | null): string {
  return value ?? "—";
}

export function WhatsappEvents({ initial }: { initial: WhatsappEventView[] }) {
  const [events, setEvents] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/whatsapp?view=raw", { cache: "no-store" });
      if (res.status === 401) {
        setError("Session expired. Sign in again.");
        return;
      }
      if (!res.ok) {
        setError("Could not refresh events.");
        return;
      }
      const data = (await res.json()) as { events: WhatsappEventView[] };
      setEvents(data.events);
      setError(null);
    } catch {
      setError("Could not refresh events.");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    return pollWhileVisible(() => void load(false), POLL_MS);
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {events.length === 0
            ? "No events stored."
            : `${events.length} event${events.length === 1 ? "" : "s"} · refreshes every 8s`}
        </p>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-wash disabled:opacity-60"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">{error}</p>
      )}

      {events.length === 0 ? (
        <div className="bg-white rounded-lg border border-line p-16 text-center">
          <p className="text-sm font-medium text-ink">No WhatsApp events yet</p>
          <p className="text-sm text-ink-muted mt-1">Events appear here after the webhook receives them.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-line overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Time (KL)</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Direction</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">From</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">To</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Text</th>
                  <th className="px-4 py-3"><span className="sr-only">Raw payload</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {events.map((event) => {
                  const open = openId === event.id;
                  return (
                    <Fragment key={event.id}>
                      <tr className="hover:bg-wash">
                        <td className="px-4 py-3 whitespace-nowrap text-ink">{formatKualaLumpur(event.receivedAt)}</td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-ink">{event.direction}</span>
                          {event.field && <span className="block text-xs text-ink-muted">{event.field}</span>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">{cell(event.fromWaId)}</td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">{cell(event.toWaId)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{cell(event.messageType)}</td>
                        <td className="px-4 py-3 max-w-xs truncate">{cell(event.textPreview)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setOpenId(open ? null : event.id)}
                            className="text-xs font-medium text-brand hover:underline"
                          >
                            {open ? "Hide" : "Raw"}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-wash">
                          <td colSpan={7} className="px-4 py-3">
                            <pre className="overflow-x-auto text-xs leading-relaxed text-ink">{pretty(event.rawBody)}</pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
