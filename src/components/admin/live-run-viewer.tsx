"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { adminLiveViewToken, adminStopJob } from "@/actions/admin-submit";
import { liveViewUrl } from "@/lib/live-view-url";
import { SUBMIT_STEPS, progressReading } from "@/lib/order-types";

type Conn = "connecting" | "live" | "reconnecting" | "finished" | "unreachable" | "no_live_view" | "too_many_viewers";
interface StageRow { name: string; detail: string | null; at: string }
interface Outcome {
  status: string;
  error?: string | null;
  error_kind?: string | null;
  order_id?: string | null;
  result_status?: string | null;
  message?: string | null;
}

const MAX_LOG_LINES = 500;
const REFRESH_BEFORE_MS = 2 * 60 * 1000;

const CONN_LABEL: Record<Conn, string> = {
  connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…", finished: "Finished",
  unreachable: "Could not reach the order service.",
  no_live_view: "Live view was not enabled for this run.",
  too_many_viewers: "Three viewers are already watching runs on the order service — close one and reload.",
};

/**
 * The droplet's screen on the left, what is happening on the right.
 *
 * Frames arrive as base64 JPEG over SSE and are painted as data URLs — no
 * blob bookkeeping, and the last frame stays up when the stream ends, which
 * is the frame that matters most.
 */
export function LiveRunViewer({ orderId, label, jobId, token: initialToken, expiresAt: initialExpiry, scraperUrl }: {
  orderId: string; label: string; jobId: string; token: string; expiresAt: number; scraperUrl: string;
}) {
  const [frame, setFrame] = useState<{ src: string; at: number } | null>(null);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [conn, setConn] = useState<Conn>("connecting");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const cred = useRef({ token: initialToken, expiresAt: initialExpiry });
  const failures = useRef(0);
  const logBox = useRef<HTMLPreElement>(null);
  const hover = useRef(false);

  // A clock for "frame N s ago".
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const refreshToken = useCallback(async () => {
    const res = await adminLiveViewToken(orderId);
    if (!res.success) return false;
    cred.current = { token: res.viewerToken, expiresAt: res.expiresAt };
    return true;
  }, [orderId]);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const open = async () => {
      if (stopped) return;
      if (cred.current.expiresAt - Date.now() < REFRESH_BEFORE_MS) await refreshToken();
      // A component unmount can land while the refresh above is still in
      // flight; re-check before doing anything the resumed continuation
      // would otherwise do unsupervised.
      if (stopped) return;
      // Probe first: EventSource cannot read a status code, and 401/404/429
      // each deserve their own sentence rather than an endless "Reconnecting…".
      try {
        const p = await fetch(liveViewUrl(scraperUrl, jobId, cred.current.token, true), { cache: "no-store" });
        if (stopped) return;
        if (p.status === 401) {
          if (failures.current++ === 0 && (await refreshToken())) {
            if (stopped) return;
            return open();
          }
          setConn("unreachable"); return;
        }
        if (p.status === 404) { const b = await p.json().catch(() => ({})); setConn(b.error === "no_live_view" ? "no_live_view" : "unreachable"); return; }
        if (p.status === 429) { setConn("too_many_viewers"); return; }
        if (!p.ok) { setConn("unreachable"); return; }
      } catch { setConn("unreachable"); return; }

      es = new EventSource(liveViewUrl(scraperUrl, jobId, cred.current.token));
      es.onopen = () => { failures.current = 0; setConn("live"); };
      es.addEventListener("hello", (e) => {
        // The droplet replays the whole stage history and log tail on every
        // new connection (api_server.py), so a reconnect must clear local
        // state before that replay lands or the panels grow duplicate rows.
        // The last frame and any outcome already recorded are left alone —
        // neither is replayed, and the frame is the thing worth keeping on
        // screen through a reconnect.
        setStages([]);
        setLog([]);
        const d = JSON.parse((e as MessageEvent).data) as { status: string };
        // The `status` event that follows carries the real outcome; this only
        // flips the connection chip so a reconnect into an already-finished
        // run does not sit forever reading "Live".
        if (d.status === "done" || d.status === "error") setConn("finished");
      });
      es.addEventListener("frame", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { jpeg: string };
        setFrame({ src: `data:image/jpeg;base64,${d.jpeg}`, at: Date.now() });
      });
      es.addEventListener("stage", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as StageRow;
        setStages((s) => [...s, d]);
      });
      es.addEventListener("log", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { line: string };
        setLog((l) => [...l, ...d.line.split("\n").filter(Boolean)].slice(-MAX_LOG_LINES));
      });
      es.addEventListener("status", (e) => {
        setOutcome(JSON.parse((e as MessageEvent).data) as Outcome);
        setConn("finished");
        es?.close();
      });
      es.onerror = () => {
        if (stopped) return;
        es?.close();
        setConn((c) => (c === "finished" ? c : "reconnecting"));
        reconnectTimer = setTimeout(open, 2000);
      };
    };
    void open();
    return () => {
      stopped = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [jobId, scraperUrl, refreshToken]);

  // Autoscroll the log unless the pointer is over it.
  useEffect(() => {
    if (!hover.current && logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [log]);

  const lastStage = stages[stages.length - 1]?.name ?? null;
  // Job status "done" is not itself success: a run the portal refused still
  // finishes as job status "done" with result_status "error" — the terminal
  // outcome BizzFlow actually recorded is result_status, not the job's own
  // done/error split (which only means "the browser stopped one way or another").
  const succeeded = outcome?.status === "done" && (outcome.result_status === "submitted" || outcome.result_status === "success");
  const status = outcome ? (succeeded ? "submitted" : "failed") : "submitting";
  const reading = progressReading(lastStage, status, stages.map((s) => s.name));
  const frameAge = frame ? Math.max(0, Math.round((now - frame.at) / 1000)) : null;

  async function stop() {
    setStopping(true);
    const res = await adminStopJob(orderId);
    setStopping(false);
    setConfirmStop(false);
    if (res.success) toast.success(res.message); else toast.error(res.error);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[#0A2540]">{label}</h1>
          <p className="text-xs text-[#697386]">Job <span className="font-mono">{jobId}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs ${conn === "live" ? "bg-[#ECFDF3] text-[#027A48]" : conn === "finished" ? "bg-[#F1F3F6] text-[#425466]" : "bg-[#FFFAEB] text-[#B54708]"}`}>
            {CONN_LABEL[conn]}
          </span>
          {conn !== "finished" && conn !== "no_live_view" && conn !== "unreachable" && (
            <button type="button" onClick={() => setConfirmStop(true)} disabled={stopping}
              className="min-h-9 rounded-md border border-[#FDA29B] bg-white px-3 py-1.5 text-sm font-medium text-[#B42318] hover:bg-[#FEF3F2] disabled:opacity-50">
              Stop this run
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
        <section className="rounded-xl border border-[#E3E8EF] bg-white p-3">
          {frame ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL that changes several times a second
            <img src={frame.src} alt="The droplet's browser" className="w-full rounded-md border border-[#E3E8EF]" />
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center rounded-md bg-[#F6F9FC] text-sm text-[#697386]">Waiting for the browser…</div>
          )}
          <p className={`mt-2 text-xs ${frameAge !== null && frameAge > 10 ? "text-[#B54708]" : "text-[#697386]"}`}>
            {frameAge === null ? "No frame yet" : `Frame ${frameAge} s ago`}
          </p>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-[#E3E8EF] bg-white p-4">
            <p className="text-sm font-semibold text-[#0A2540]">{reading.heading}</p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-[#F1F3F6]"><div className="h-1.5 rounded-full bg-[#635BFF]" style={{ width: `${reading.pct}%` }} /></div>
            <ol className="mt-3 space-y-1 text-xs">
              {SUBMIT_STEPS.map((s, i) => (
                <li key={s.key} className={i < reading.done ? "text-[#027A48]" : i === reading.current ? "font-medium text-[#0A2540]" : "text-[#98A2B3]"}>
                  {i < reading.done ? "✓ " : i === reading.current ? "▸ " : "· "}{s.label}
                </li>
              ))}
            </ol>
            {outcome && (
              <p className={`mt-3 rounded-md px-3 py-2 text-xs ${succeeded ? "bg-[#ECFDF3] text-[#027A48]" : "bg-[#FEF3F2] text-[#B42318]"}`}>
                {succeeded
                  ? "The run finished."
                  : `The run ended with an error${outcome.error_kind ? ` (${outcome.error_kind})` : ""}: ${outcome.message ?? outcome.error ?? "no message"}`}
                {outcome.order_id ? ` Portal order ${outcome.order_id}.` : ""}{" "}
                <a href={`/admin/orders/${orderId}`} className="underline">Open the order</a>
              </p>
            )}
          </section>

          <section className="rounded-xl border border-[#E3E8EF] bg-white p-4">
            <p className="text-sm font-semibold text-[#0A2540]">Stages</p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-[#425466]">
              {stages.length === 0 && <li className="text-[#98A2B3]">Nothing reported yet.</li>}
              {stages.map((s, i) => (
                <li key={`${s.at}-${i}`}><span className="font-mono text-[#98A2B3]">{s.at.slice(11, 19)}</span> {s.name}{s.detail ? ` — ${s.detail}` : ""}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-[#E3E8EF] bg-white p-4">
            <p className="text-sm font-semibold text-[#0A2540]">Run log</p>
            <pre ref={logBox} onMouseEnter={() => { hover.current = true; }} onMouseLeave={() => { hover.current = false; }}
              className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#0A2540] p-3 font-mono text-[11px] leading-4 text-[#E3E8EF]">
              {log.length === 0 ? "Waiting for the log…" : log.join("\n")}
            </pre>
          </section>
        </aside>
      </div>

      {confirmStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A2540]/40 p-4" role="dialog" aria-modal="true" aria-labelledby="stop-run-title">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 id="stop-run-title" className="text-base font-semibold text-[#0A2540]">Stop this run?</h3>
            <p className="mt-2 text-sm text-[#425466]">
              The browser is torn down where it stands. The portal mints the Customer Order Number early, so a run stopped mid-flight can leave a real order at Unifi — check the portal before submitting again.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmStop(false)} className="rounded-md border border-[#E3E8EF] px-3 py-2 text-sm text-[#425466]">Keep running</button>
              <button type="button" onClick={stop} disabled={stopping} className="rounded-md bg-[#B42318] px-3 py-2 text-sm text-white disabled:opacity-50">{stopping ? "Stopping…" : "Stop the run"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
