"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WhatsappConnection } from "@/components/admin/whatsapp-connection";
import { WhatsappContactPanel } from "@/components/admin/whatsapp-contact";
import { WhatsappEvents } from "@/components/admin/whatsapp-events";
import { WhatsappThread } from "@/components/admin/whatsapp-thread";
import { getWhatsappContact, markWhatsappRead, setWhatsappClosed, type WhatsappContact } from "@/actions/whatsapp";
import type { WhatsappEventView } from "@/lib/whatsapp-events";
import {
  buildInbox,
  chatInTab,
  filterInbox,
  isClosed,
  unreadFor,
  type ConversationState,
  type InboxChat,
  type InboxTab,
} from "@/lib/whatsapp-inbox";
import { formatKualaLumpur } from "@/lib/whatsapp-webhook";
import { toast } from "@/lib/toast";

const POLL_MS = 8_000;

type Conversations = Record<string, ConversationState>;

export function WhatsappDesk({
  initial,
  initialConversations,
}: {
  initial: WhatsappEventView[];
  initialConversations: Conversations;
}) {
  const [view, setView] = useState<"inbox" | "raw">("inbox");
  const [connected, setConnected] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">WhatsApp</h1>
          <p className="mt-1 hidden text-sm text-ink-muted sm:block">Customer messages on the left, business replies on the right. Replies send from the business number.</p>
        </div>
        <div className="flex rounded-lg border border-line bg-white p-0.5">
          <ViewButton current={view} id="inbox" onSelect={setView}>Inbox</ViewButton>
          <ViewButton current={view} id="raw" onSelect={setView}>Raw events</ViewButton>
        </div>
      </div>
      <WhatsappConnection onConnectedChange={setConnected} />
      {view === "inbox" ? (
        <WhatsappInbox initial={initial} initialConversations={initialConversations} connected={connected} />
      ) : (
        <WhatsappEvents initial={initial} />
      )}
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

const TABS: { id: InboxTab; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "unread", label: "Unread" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

function WhatsappInbox({
  initial,
  initialConversations,
  connected,
}: {
  initial: WhatsappEventView[];
  initialConversations: Conversations;
  connected: boolean;
}) {
  const [events, setEvents] = useState(initial);
  const [conversations, setConversations] = useState(initialConversations);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<InboxTab>("open");
  const [selected, setSelected] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Record<string, WhatsappContact | string>>({});
  const selectedRef = useRef<string | null>(null);

  /** Shared read state: the newest customer message on screen counts as read. */
  const markRead = useCallback((chat: InboxChat, state: Conversations) => {
    const at = chat.lastInboundAt;
    if (!at) return;
    const prev = state[chat.customer]?.lastReadAt ?? null;
    if (prev && Date.parse(prev) >= Date.parse(at)) return;
    setConversations((current) => ({
      ...current,
      [chat.customer]: { closedAt: current[chat.customer]?.closedAt ?? null, lastReadAt: at },
    }));
    void markWhatsappRead(chat.customer, at);
  }, []);

  const load = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/whatsapp", { cache: "no-store" });
      if (res.status === 401) {
        setError("Session expired. Sign in again.");
        return;
      }
      if (!res.ok) {
        setError("Could not refresh chats.");
        return;
      }
      const data = (await res.json()) as { events: WhatsappEventView[]; conversations: Conversations };
      setEvents(data.events);
      setConversations(data.conversations);
      setError(null);
      const open = selectedRef.current && buildInbox(data.events).find((c) => c.customer === selectedRef.current);
      if (open) markRead(open, data.conversations);
    } catch {
      setError("Could not refresh chats.");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [markRead]);

  useEffect(() => {
    const id = setInterval(() => {
      void load(false);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const chats = useMemo(() => buildInbox(events), [events]);
  const searched = useMemo(() => filterInbox(chats, query), [chats, query]);
  const visible = searched.filter((chat) => chatInTab(chat, conversations[chat.customer], tab));
  const active = chats.find((chat) => chat.customer === selected) ?? null;

  function select(chat: InboxChat | null) {
    setSelected(chat?.customer ?? null);
    selectedRef.current = chat?.customer ?? null;
    if (!chat) return;
    markRead(chat, conversations);
    if (contacts[chat.customer] === undefined) {
      void getWhatsappContact(chat.customer).then((res) =>
        setContacts((current) => ({ ...current, [chat.customer]: res.success ? res.data : res.error })),
      );
    }
  }

  async function toggleClosed(chat: InboxChat, closed: boolean) {
    const prev = conversations[chat.customer];
    const closedAt = closed ? new Date().toISOString() : null;
    setConversations((current) => ({
      ...current,
      [chat.customer]: { lastReadAt: current[chat.customer]?.lastReadAt ?? null, closedAt },
    }));
    const res = await setWhatsappClosed(chat.customer, closed);
    if (!res.success) {
      toast.error(res.error);
      setConversations((current) => ({ ...current, [chat.customer]: prev ?? { closedAt: null, lastReadAt: null } }));
      return;
    }
    if (closed) select(null);
  }

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[24rem] overflow-hidden rounded-lg border border-line bg-white md:h-[calc(100dvh-13rem)]">
      <section className={`${active ? "hidden md:flex" : "flex"} w-full min-w-0 flex-col border-line md:w-80 md:shrink-0 md:border-r`}>
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex gap-1" role="group" aria-label="Filter chats">
            {TABS.map(({ id, label }) => {
              const count = searched.filter((chat) => chatInTab(chat, conversations[chat.customer], id)).length;
              const on = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTab(id)}
                  className={`min-h-9 flex-1 rounded-md px-2 text-xs font-medium ${on ? "bg-ink text-white" : "text-ink-muted hover:bg-wash hover:text-ink"}`}
                >
                  {label} <span className={on ? "text-white/70" : ""}>{count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="whatsapp-search" className="sr-only">Search number or message</label>
            <input
              id="whatsapp-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search number or message"
              className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
            />
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="text-xs font-medium text-brand hover:underline disabled:opacity-60"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        {error && <p className="m-3 text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">
              {chats.length === 0 ? "No WhatsApp chats yet" : query ? "No chats match" : `No ${tab === "all" ? "" : `${tab} `}chats`}
            </p>
          ) : (
            <ul>
              {visible.map((chat) => {
                const state = conversations[chat.customer];
                const unread = unreadFor(chat, state);
                const on = chat.customer === selected;
                return (
                  <li key={chat.customer}>
                    <button
                      type="button"
                      onClick={() => select(chat)}
                      aria-current={on ? "true" : undefined}
                      className={`w-full border-b border-line/60 px-3 py-3 text-left hover:bg-wash ${on ? "bg-wash" : ""}`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-sm font-medium text-ink">{chat.customer}</span>
                        <span className="shrink-0 text-[11px] text-ink-muted">{formatKualaLumpur(chat.lastAt)}</span>
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-ink-muted">{chat.preview}</span>
                        {isClosed(chat.lastInboundAt, state?.closedAt) ? (
                          <span className="shrink-0 rounded-full bg-wash px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">Closed</span>
                        ) : unread > 0 ? (
                          <span className="shrink-0 rounded-full bg-ink px-1.5 py-0.5 text-[11px] font-medium text-white">
                            {unread}<span className="sr-only"> unread</span>
                          </span>
                        ) : null}
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
          <WhatsappThread
            chat={active}
            closedAt={conversations[active.customer]?.closedAt ?? null}
            connected={connected}
            onBack={() => select(null)}
            onToggleClosed={(closed) => void toggleClosed(active, closed)}
            onSent={() => void load(false)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="text-sm text-ink-muted">Select a chat</p>
          </div>
        )}
      </section>

      <WhatsappContactPanel waId={active?.customer ?? null} contact={active ? contacts[active.customer] : undefined} />
    </div>
  );
}
