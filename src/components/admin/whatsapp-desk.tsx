"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WhatsappEvents } from "@/components/admin/whatsapp-events";
import type { WhatsappEventView } from "@/lib/whatsapp-events";
import { buildInbox, filterInbox, openedAtAfterViewing, unreadCount } from "@/lib/whatsapp-inbox";
import { formatKualaLumpur } from "@/lib/whatsapp-webhook";

const POLL_MS = 8_000;
const OPENED_KEY = "whatsapp-inbox-opened";

function readOpened(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OPENED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const opened: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") opened[key] = value;
    }
    return opened;
  } catch {
    return {};
  }
}

function writeOpened(opened: Record<string, string>) {
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify(opened));
  } catch {
    // Private mode can reject the write. The badge still updates in memory.
  }
}

export function WhatsappDesk({ initial }: { initial: WhatsappEventView[] }) {
  const [view, setView] = useState<"inbox" | "raw">("inbox");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">WhatsApp</h1>
          <p className="text-sm text-ink-muted mt-1">Read only. Inbound on the left, business replies on the right.</p>
        </div>
        <div className="flex rounded-lg border border-line bg-white p-0.5">
          <ViewButton current={view} id="inbox" onSelect={setView}>Inbox</ViewButton>
          <ViewButton current={view} id="raw" onSelect={setView}>Raw events</ViewButton>
        </div>
      </div>
      {view === "inbox" ? <WhatsappInbox initial={initial} /> : <WhatsappEvents initial={initial} />}
    </div>
  );
}

function ViewButton({
  current,
  id,
  onSelect,
  children,
}: {
  current: "inbox" | "raw";
  id: "inbox" | "raw";
  onSelect: (id: "inbox" | "raw") => void;
  children: string;
}) {
  const on = current === id;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onSelect(id)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${on ? "bg-ink text-white" : "text-ink-muted hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function WhatsappInbox({ initial }: { initial: WhatsappEventView[] }) {
  const [events, setEvents] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, string> | null>(null);

  const load = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/whatsapp", { cache: "no-store" });
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
    setOpened(readOpened());
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      void load(false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const chats = useMemo(() => buildInbox(events), [events]);
  const visible = useMemo(() => filterInbox(chats, query), [chats, query]);
  const active = chats.find((chat) => chat.customer === selected) ?? null;

  useEffect(() => {
    if (!active) return;
    const prev = readOpened();
    const at = openedAtAfterViewing(active.messages, new Date().toISOString());
    if (prev[active.customer] === at) return;
    const next = { ...prev, [active.customer]: at };
    writeOpened(next);
    setOpened(next);
  }, [active]);

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[24rem] overflow-hidden rounded-lg border border-line bg-white md:h-[calc(100dvh-13rem)]">
      <section className={`${active ? "hidden md:flex" : "flex"} w-full min-w-0 flex-col border-line md:w-80 md:shrink-0 md:border-r`}>
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-ink-muted">{chats.length === 0 ? "No chats" : `${visible.length} chat${visible.length === 1 ? "" : "s"}`}</p>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="text-xs font-medium text-brand hover:underline disabled:opacity-60"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <label htmlFor="whatsapp-search" className="sr-only">Search number or message</label>
          <input
            id="whatsapp-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search number or message"
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
        </div>
        {error && <p className="m-3 text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">
              {chats.length === 0 ? "No WhatsApp chats yet" : "No chats match"}
            </p>
          ) : (
            <ul>
              {visible.map((chat) => {
                const unread = opened ? unreadCount(chat.messages, opened[chat.customer] ?? null) : 0;
                const on = chat.customer === selected;
                return (
                  <li key={chat.customer}>
                    <button
                      type="button"
                      onClick={() => setSelected(chat.customer)}
                      aria-current={on ? "true" : undefined}
                      className={`w-full border-b border-line/60 px-3 py-3 text-left hover:bg-wash ${on ? "bg-wash" : ""}`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-sm font-medium text-ink">{chat.customer}</span>
                        <span className="shrink-0 text-[11px] text-ink-muted">{formatKualaLumpur(chat.lastAt)}</span>
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-ink-muted">{chat.preview}</span>
                        {unread > 0 && (
                          <span className="shrink-0 rounded-full bg-ink px-1.5 py-0.5 text-[11px] font-medium text-white">{unread}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className={`${active ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {active ? (
          <>
            <div className="flex items-center gap-2 border-b border-line px-3 py-3">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg px-2 py-1 text-sm font-medium text-ink hover:bg-wash md:hidden"
              >
                Chats
              </button>
              <h2 className="font-mono text-sm font-medium text-ink">{active.customer}</h2>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {active.messages.map((message) => {
                const echo = message.side === "echo";
                return (
                  <div key={message.id} className={`flex ${echo ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 ${echo ? "bg-ink text-white" : "bg-wash text-ink"}`}>
                      <span className="sr-only">{echo ? "Business" : "Customer"}</span>
                      <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
                      <p className={`mt-1 text-[11px] ${echo ? "text-white/70" : "text-ink-muted"}`}>{formatKualaLumpur(message.at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="text-sm text-ink-muted">Select a chat</p>
          </div>
        )}
      </section>

      <aside className="hidden w-56 shrink-0 flex-col border-l border-line p-4 lg:flex">
        <h2 className="text-sm font-semibold text-ink">Contact</h2>
        <p className="mt-2 text-sm text-ink-muted">Contact details coming soon</p>
      </aside>
    </div>
  );
}
