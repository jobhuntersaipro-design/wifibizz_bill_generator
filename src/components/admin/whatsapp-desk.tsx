"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WhatsappConnection } from "@/components/admin/whatsapp-connection";
import { WhatsappContactPanel } from "@/components/admin/whatsapp-contact";
import { LabelChip, WhatsappCrmControls, WhatsappLabelSettings } from "@/components/admin/whatsapp-crm";
import { WhatsappThread } from "@/components/admin/whatsapp-thread";
import {
  analyzeWhatsappChat,
  getWhatsappContact,
  markWhatsappRead,
  releaseWhatsappChatLabel,
  setWhatsappChatLabel,
  setWhatsappClosed,
  type CrmField,
  type WhatsappContact,
} from "@/actions/whatsapp";
import { ChevronRight, Loader2 } from "lucide-react";
import {
  contactName,
  isClosed,
  matchesFilter,
  summaryInTab,
  type ChatFilter,
  type ChatSummary,
  type InboxMessage,
  type InboxTab,
  type Label,
  type LabelKind,
} from "@/lib/whatsapp-inbox";
import { formatKualaLumpur } from "@/lib/whatsapp-webhook";
import { toast } from "@/lib/toast";
import { pollWhileVisible } from "@/lib/poll";

const POLL_MS = 8_000;

type View = "inbox" | "settings";

export function WhatsappDesk({
  initialChats,
  initialLabels,
}: {
  initialChats: ChatSummary[];
  initialLabels: Label[];
}) {
  const [view, setView] = useState<View>("inbox");
  const [connected, setConnected] = useState(false);
  const [labels, setLabels] = useState(initialLabels);

  const reloadLabels = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp?view=labels", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setLabels(((await res.json()) as { labels: Label[] }).labels);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">WhatsApp</h1>
          <p className="mt-1 hidden text-sm text-ink-muted sm:block">
            Chats from the linked number, sorted into lead stages by AI. Replies send from the business number.
          </p>
        </div>
        <div className="flex rounded-lg border border-line bg-white p-0.5">
          <ViewButton current={view} id="inbox" onSelect={setView}>Inbox</ViewButton>
          <ViewButton current={view} id="settings" onSelect={setView}>Settings</ViewButton>
        </div>
      </div>
      <WhatsappConnection onConnectedChange={setConnected} />
      {view === "inbox" ? (
        <WhatsappInbox initialChats={initialChats} labels={labels} onLabels={setLabels} connected={connected} />
      ) : (
        <WhatsappLabelSettings labels={labels} onChanged={() => void reloadLabels()} />
      )}
    </div>
  );
}

function ViewButton({ current, id, onSelect, children }: { current: View; id: View; onSelect: (id: View) => void; children: string }) {
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

const NO_FILTER: ChatFilter = { folderId: null, stageId: null, tagId: null };

function WhatsappInbox({
  initialChats,
  labels,
  onLabels,
  connected,
}: {
  initialChats: ChatSummary[];
  labels: Label[];
  onLabels: (labels: Label[]) => void;
  connected: boolean;
}) {
  const [chats, setChats] = useState(initialChats);
  const [threads, setThreads] = useState<Record<string, InboxMessage[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<InboxTab>("open");
  const [filter, setFilter] = useState<ChatFilter>(NO_FILTER);
  const [selected, setSelected] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Record<string, WhatsappContact | string>>({});
  const selectedRef = useRef<string | null>(null);
  const queryRef = useRef("");

  const [grouped, setGrouped] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);

  const patchChat = useCallback((waId: string, patch: Partial<ChatSummary>) => {
    setChats((current) => current.map((c) => (c.customer === waId ? { ...c, ...patch } : c)));
  }, []);

  /** Shared read state: the newest customer message on screen counts as read. */
  const markRead = useCallback((chat: ChatSummary) => {
    const at = chat.lastInboundAt;
    if (!at || (chat.lastReadAt && Date.parse(chat.lastReadAt) >= Date.parse(at))) return;
    patchChat(chat.customer, { lastReadAt: at, unread: 0 });
    void markWhatsappRead(chat.customer, at);
  }, [patchChat]);

  const loadThread = useCallback(async (waId: string) => {
    const res = await fetch(`/api/admin/whatsapp?chat=${waId}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { messages: InboxMessage[] };
    setThreads((current) => ({ ...current, [waId]: data.messages }));
  }, []);

  const load = useCallback(async (manual: boolean) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/whatsapp?q=${encodeURIComponent(queryRef.current)}`, { cache: "no-store" });
      if (res.status === 401) {
        setError("Session expired. Sign in again.");
        return;
      }
      if (!res.ok) {
        setError("Could not refresh chats.");
        return;
      }
      const data = (await res.json()) as { chats: ChatSummary[]; labels: Label[] };
      setChats(data.chats);
      onLabels(data.labels);
      setError(null);
      const open = selectedRef.current && data.chats.find((c) => c.customer === selectedRef.current);
      if (open) {
        markRead(open);
        void loadThread(open.customer);
      }
    } catch {
      setError("Could not refresh chats.");
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [loadThread, markRead, onLabels]);

  useEffect(() => {
    // Fresh on mount too: coming back from Settings must not show the page-load snapshot.
    void load(false);
    return pollWhileVisible(() => void load(false), POLL_MS);
  }, [load]);

  // Search runs on the server (it covers every message, not just the previews here).
  useEffect(() => {
    if (queryRef.current === query.trim()) return;
    const id = setTimeout(() => {
      queryRef.current = query.trim();
      void load(true);
    }, 300);
    return () => clearTimeout(id);
  }, [query, load]);

  const filtered = chats.filter((chat) => matchesFilter(chat, filter));
  const visible = filtered.filter((chat) => summaryInTab(chat, tab));
  const stageGroups = [...labels.filter((l) => l.kind === "stage"), { id: "", name: "No stage" }]
    .map((l) => ({ id: l.id, name: l.name, chats: visible.filter((c) => (c.stageId && labelById.has(c.stageId) ? c.stageId : "") === l.id) }))
    .filter((g) => g.chats.length > 0);
  const active = chats.find((chat) => chat.customer === selected) ?? null;
  const activeMessages = active ? threads[active.customer] : undefined;

  function select(chat: ChatSummary | null) {
    setSelected(chat?.customer ?? null);
    selectedRef.current = chat?.customer ?? null;
    if (!chat) return;
    markRead(chat);
    void loadThread(chat.customer);
    if (contacts[chat.customer] === undefined) {
      void getWhatsappContact(chat.customer).then((res) =>
        setContacts((current) => ({ ...current, [chat.customer]: res.success ? res.data : res.error })),
      );
    }
  }

  async function toggleClosed(chat: ChatSummary, closed: boolean) {
    const prev = chat.closedAt;
    patchChat(chat.customer, { closedAt: closed ? new Date().toISOString() : null });
    const res = await setWhatsappClosed(chat.customer, closed);
    if (!res.success) {
      toast.error(res.error);
      patchChat(chat.customer, { closedAt: prev });
      return;
    }
    if (closed) select(null);
  }

  async function setLabel(chat: ChatSummary, field: CrmField, value: string | string[] | null) {
    const prev = { ...chat };
    patchChat(chat.customer,
      field === "stage" ? { stageId: value as string | null, stageBy: "admin" }
      : field === "folder" ? { folderId: value as string | null, folderBy: "admin" }
      : { tagIds: value as string[], tagsBy: "admin" });
    const res = await setWhatsappChatLabel(chat.customer, field, value);
    if (!res.success) {
      toast.error(res.error);
      patchChat(chat.customer, prev);
    }
  }

  async function release(chat: ChatSummary, field: CrmField) {
    const by = field === "stage" ? "stageBy" : field === "folder" ? "folderBy" : field === "insight" ? "insightBy" : "tagsBy";
    patchChat(chat.customer, { [by]: null });
    const res = await releaseWhatsappChatLabel(chat.customer, field);
    if (!res.success) {
      toast.error(res.error);
      patchChat(chat.customer, { [by]: "admin" });
      return;
    }
    toast.success("Handed back to AI. It re-sorts 3 minutes after the customer's next message.");
  }

  const [analyzing, setAnalyzing] = useState<string | null>(null);
  async function analyze(chat: ChatSummary) {
    setAnalyzing(chat.customer);
    const res = await analyzeWhatsappChat(chat.customer);
    setAnalyzing(null);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("AI analysis done.");
    await load(false);
  }

  function chatRow(chat: ChatSummary) {
    const on = chat.customer === selected;
    const stage = chat.stageId ? labelById.get(chat.stageId) : undefined;
    const name = contactName(chat.name);
    return (
      <li key={chat.customer}>
        <button
          type="button"
          onClick={() => select(chat)}
          aria-current={on ? "true" : undefined}
          className={`w-full border-b border-line/60 px-3 py-3 text-left hover:bg-wash ${on ? "bg-wash" : ""}`}
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium text-ink">{name ?? <span className="font-mono">+{chat.customer}</span>}</span>
            <span className="shrink-0 text-[11px] text-ink-muted">{formatKualaLumpur(chat.lastAt)}</span>
          </span>
          {name && <span className="block truncate font-mono text-xs text-ink-muted">+{chat.customer}</span>}
          <span className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate text-sm text-ink-muted">{chat.preview}</span>
            {chat.unread > 0 ? (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25D366] px-1.5 text-[11px] font-semibold text-white">
                {chat.unread > 99 ? "99+" : chat.unread}<span className="sr-only"> new messages</span>
              </span>
            ) : isClosed(chat.lastInboundAt, chat.closedAt) ? (
              <span className="shrink-0 rounded-full bg-wash px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">Closed</span>
            ) : null}
          </span>
          {(stage || chat.signupChance !== null) && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {chat.signupChance !== null && (
                <span title={chat.intent ?? undefined} className="rounded-full bg-wash px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-ink">
                  {chat.signupChance}%<span className="sr-only"> sign-up chance</span>
                </span>
              )}
              {stage && <LabelChip label={stage} />}
                                      </span>
          )}
        </button>
      </li>
    );
  }

  const crm = active ? (
    <WhatsappCrmControls
      chat={active}
      labels={labels}
      onSet={(field, value) => void setLabel(active, field, value)}
      onRelease={(field) => void release(active, field)}
      onAnalyze={() => void analyze(active)}
      analyzing={analyzing === active.customer}
    />
  ) : null;

  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[24rem] overflow-hidden rounded-lg border border-line bg-white md:h-[calc(100dvh-13rem)]">
      <section className={`${active ? "hidden md:flex" : "flex"} w-full min-w-0 flex-col border-line md:w-80 md:shrink-0 md:border-r`}>
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex gap-1" role="group" aria-label="Filter chats">
            {TABS.map(({ id, label }) => {
              const count = filtered.filter((chat) => summaryInTab(chat, id)).length;
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
          <div className="grid grid-cols-2 gap-1">
            <LabelFilter kind="stage" title="Stage" labels={labels} value={filter.stageId} onChange={(stageId) => setFilter({ ...filter, stageId })} />
            <button
              type="button"
              aria-pressed={grouped}
              onClick={() => setGrouped((g) => !g)}
              className={`min-h-9 rounded-md border px-2 text-xs font-medium ${grouped ? "border-ink bg-ink text-white" : "border-line text-ink hover:bg-wash"}`}
            >
              Group by stage
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="whatsapp-search" className="sr-only">Search name, number or message</label>
            <input
              id="whatsapp-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, number or message"
              className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
            />
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline disabled:opacity-60"
            >
              {refreshing && <Loader2 className="size-3 animate-spin" aria-hidden />}
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        {error && <p className="m-3 text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">
              {chats.length === 0 ? (query ? "No chats match" : "No WhatsApp chats yet") : `No ${tab === "all" ? "" : `${tab} `}chats${filter.folderId || filter.stageId || filter.tagId ? " with this filter" : ""}`}
            </p>
          ) : (
            grouped ? (
              <div>
                {stageGroups.map((g) => {
                  const open = !collapsed.has(g.id);
                  return (
                    <section key={g.id || "none"}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setCollapsed((c) => { const n = new Set(c); if (open) n.add(g.id); else n.delete(g.id); return n; })}
                        className="sticky top-0 z-10 flex w-full items-center justify-between gap-2 border-b border-line bg-wash px-3 py-2 text-left text-xs font-semibold text-ink"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <ChevronRight className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
                          <span className="truncate">{g.name}</span>
                        </span>
                        <span className="tabular-nums text-ink-muted">{g.chats.length}</span>
                      </button>
                      {open && <ul>{g.chats.map(chatRow)}</ul>}
                    </section>
                  );
                })}
              </div>
            ) : (
              <ul>{visible.map(chatRow)}</ul>
            )
          )}
        </div>
      </section>

      <section className={`${active ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {active ? (
          <>
            <details className="border-b border-line px-3 py-2 xl:hidden">
              <summary className="cursor-pointer text-sm font-medium text-ink">AI analysis, summary & stage</summary>
              <div className="pt-3">{crm}</div>
            </details>
            {activeMessages ? (
              <WhatsappThread
                chat={{ customer: active.customer, messages: activeMessages, lastAt: active.lastAt, preview: active.preview, lastInboundAt: active.lastInboundAt }}
                name={contactName(active.name)}
                closedAt={active.closedAt}
                connected={connected}
                onBack={() => select(null)}
                onToggleClosed={(closed) => void toggleClosed(active, closed)}
                onSent={() => void loadThread(active.customer)}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-ink-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Loading messages…
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="text-sm text-ink-muted">Select a chat</p>
          </div>
        )}
      </section>

      <WhatsappContactPanel
        waId={active?.customer ?? null}
        name={contactName(active?.name)}
        contact={active ? contacts[active.customer] : undefined}
        crm={crm}
      />
    </div>
  );
}

function LabelFilter({
  kind,
  title,
  labels,
  value,
  onChange,
}: {
  kind: LabelKind;
  title: string;
  labels: Label[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const id = `wa-filter-${kind}`;
  return (
    <>
      <label htmlFor={id} className="sr-only">{title}</label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className={`min-w-0 rounded-md border px-1.5 py-1.5 text-xs ${value ? "border-ink text-ink" : "border-line text-ink-muted"}`}
      >
        <option value="">All {title.toLowerCase()}s</option>
        {labels.filter((l) => l.kind === kind).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </>
  );
}
