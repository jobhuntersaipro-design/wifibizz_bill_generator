"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WhatsappConnection } from "@/components/admin/whatsapp-connection";
import { WhatsappContactPanel } from "@/components/admin/whatsapp-contact";
import { ContactAvatar } from "@/components/admin/whatsapp-avatar";
import { LabelChip, WhatsappCrmControls, WhatsappLabelSettings } from "@/components/admin/whatsapp-crm";
import { WhatsappThread } from "@/components/admin/whatsapp-thread";
import { WhatsappAlerts, WhatsappKnowledgeSettings, WhatsappPushToOrderEntry } from "@/components/admin/whatsapp-ai";
import {
  analyzeWhatsappChat,
  getWhatsappContact,
  markWhatsappRead,
  releaseWhatsappChatLabel,
  setWhatsappChatLabel,
  setWhatsappChatName,
  setWhatsappClosed,
  type CrmField,
  type WhatsappContact,
} from "@/actions/whatsapp";
import { ChevronDown, ChevronRight, Inbox, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { Progress as ArcProgress } from "@/components/arc/components/progress/progress";
import SegmentedControl from "@/components/arc/components/segmented-control/segmented-control";
import { SearchField } from "@/components/arc/components/search-field/search-field";
import { Badge } from "@/components/arc/components/badge/badge";
import { Button } from "@/components/arc/components/button/button";
import { Switch } from "@/components/arc/components/switch/switch";
import { Skeleton } from "@/components/arc/components/skeleton/skeleton";
import { EmptyState } from "@/components/arc/components/empty-state/empty-state";
import { useIsArc } from "@/components/design/use-design";
import type { HistorySync } from "@/lib/whatsapp-events";
import {
  contactName,
  historyLoading,
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
import { toast } from "@/lib/toast";
import { pollWhileVisible } from "@/lib/poll";

const POLL_MS = 8_000;

type View = "inbox" | "settings";
type Transport = "dualhook" | "gateway";

export function WhatsappDesk({
  initialChats,
  initialLabels,
  initialHistory,
  transport,
}: {
  initialChats: ChatSummary[];
  initialLabels: Label[];
  initialHistory: HistorySync | null;
  /** dualhook: Meta Coexistence through Dualhook (Claude replies, 24h window). gateway: the QR-linked device. */
  transport: Transport;
}) {
  const [view, setView] = useState<View>("inbox");
  // null = unknown (still loading or the gateway did not answer): keep showing the inbox.
  const [gatewayConnected, setConnected] = useState<boolean | null>(null);
  const connected = transport === "dualhook" ? true : gatewayConnected;
  const [labels, setLabels] = useState(initialLabels);
  const [history, setHistory] = useState(initialHistory);
  // This page always uses Arc; in Arc mode the <html> attribute (and its accent) already applies.
  const arc = useIsArc();

  const reloadLabels = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp?view=labels", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setLabels(((await res.json()) as { labels: Label[] }).labels);
  }, []);

  return (
    <div data-design={arc ? undefined : "arc"} className="space-y-4 text-ink">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">WhatsApp</h1>
            {transport === "dualhook" && (
              <Badge tone="success" size="sm" icon={<span className="size-1.5 rounded-full bg-current" />}>
                Connected · Dualhook
              </Badge>
            )}
          </div>
          <p className="mt-1 hidden text-sm text-ink-muted sm:block">
            AI sorts each chat 3 minutes after the customer&apos;s last message. Stages you set by hand stay until you hand them back.
          </p>
        </div>
        <SegmentedControl
          label="View"
          value={view}
          onValueChange={(v) => setView(v as View)}
          options={[{ value: "inbox", label: "Inbox" }, { value: "settings", label: "Settings" }]}
        />
      </header>
      {transport === "gateway" && <WhatsappConnection onConnectedChange={setConnected} />}
      {view === "inbox" ? (
        <>
          {transport === "dualhook" && <WhatsappAlerts />}
          {historyLoading(history) && history && <HistoryBanner progress={history.progress} />}
          {connected === false ? (
            <EmptyState
              icon={<MessageCircle width={24} height={24} strokeWidth={1.5} />}
              title="No WhatsApp number linked"
              description="Scan the QR above. The linked number's chats load here."
            />
          ) : (
            <WhatsappInbox
              initialChats={initialChats}
              labels={labels}
              onLabels={setLabels}
              onHistory={setHistory}
              historyActive={historyLoading(history)}
              connected={connected === true}
              transport={transport}
            />
          )}
        </>
      ) : (
        <>
          {transport === "dualhook" && <WhatsappKnowledgeSettings />}
          <WhatsappLabelSettings labels={labels} onChanged={() => void reloadLabels()} />
        </>
      )}
    </div>
  );
}

function HistoryBanner({ progress }: { progress: number }) {
  return (
    <section role="status" className="rounded-xl border border-line bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" aria-hidden /> Loading historical messages…
        </p>
        <p className="text-xs text-ink-muted">WhatsApp is sending past chats from the phone. New chats appear as they arrive.</p>
        <ArcProgress value={progress} label="History import" showValue className="mt-2" />
      </div>
    </section>
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
  onHistory,
  historyActive,
  connected,
  transport,
}: {
  initialChats: ChatSummary[];
  labels: Label[];
  onLabels: (labels: Label[]) => void;
  onHistory: (history: HistorySync | null) => void;
  /** History import running: show placeholder rows under the chats. */
  historyActive: boolean;
  connected: boolean;
  transport: Transport;
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
      const data = (await res.json()) as { chats: ChatSummary[]; labels: Label[]; history?: HistorySync | null };
      setChats(data.chats);
      onLabels(data.labels);
      onHistory(data.history ?? null);
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
  }, [loadThread, markRead, onLabels, onHistory]);

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

  async function rename(chat: ChatSummary, next: string) {
    const res = await setWhatsappChatName(chat.customer, next);
    if (!res.success) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    await load(false);
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
    const unread = chat.unread > 0;
    return (
      <li key={chat.customer}>
        <button
          type="button"
          onClick={() => select(chat)}
          aria-current={on ? "true" : undefined}
          className={`relative flex w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-wash ${on ? "bg-wash" : ""}`}
        >
          {on && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-ink" aria-hidden />}
          <ContactAvatar waId={chat.customer} name={name} photo={transport === "gateway"} />
          <span className="block min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className={`truncate text-sm text-ink ${unread ? "font-semibold" : "font-medium"}`}>
                {name ?? `+${chat.customer}`}
              </span>
              <span className={`shrink-0 text-[11px] tabular-nums ${unread ? "font-medium text-emerald-700" : "text-ink-muted"}`}>
                {shortTime(chat.lastAt)}
              </span>
            </span>
            {name && <span className="block truncate text-xs tabular-nums text-ink-muted">+{chat.customer}</span>}
            <span className="mt-0.5 flex items-center justify-between gap-2">
              <span className={`truncate text-sm ${unread ? "text-ink" : "text-ink-muted"}`}>{chat.preview || "—"}</span>
              {unread ? (
                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25D366] px-1.5 text-[11px] font-semibold text-white">
                  {chat.unread > 99 ? "99+" : chat.unread}<span className="sr-only"> new messages</span>
                </span>
              ) : null}
            </span>
            {(stage || chat.signupChance !== null || isClosed(chat.lastInboundAt, chat.closedAt)) && (
              <span className="mt-1.5 flex flex-wrap items-center gap-1">
                {stage && <LabelChip label={stage} />}
                {chat.signupChance !== null && (
                  <Badge size="sm" tone={chat.signupChance >= 60 ? "success" : chat.signupChance >= 30 ? "warning" : "neutral"}>
                    {chat.signupChance}% sign-up
                  </Badge>
                )}
                {isClosed(chat.lastInboundAt, chat.closedAt) && <Badge size="sm">Closed</Badge>}
              </span>
            )}
          </span>
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

  const contactPanel = (
    <WhatsappContactPanel
      waId={active?.customer ?? null}
      name={contactName(active?.name)}
      namedByAdmin={active?.namedByAdmin ?? false}
      photo={transport === "gateway"}
      onRename={active ? (next) => rename(active, next) : undefined}
      contact={active ? contacts[active.customer] : undefined}
      crm={crm}
    />
  );

  const filtering = filter.folderId || filter.stageId || filter.tagId;
  return (
    <div className="flex h-[calc(100dvh-11rem)] min-h-[28rem] overflow-hidden rounded-xl border border-line bg-card shadow-sm md:h-[calc(100dvh-12rem)]">
      <section className={`${active ? "hidden md:flex" : "flex"} w-full min-w-0 flex-col border-line md:w-[24rem] md:shrink-0 md:border-r`}>
        <div className="space-y-3 border-b border-line p-3">
          <div className="flex items-center gap-2 [&_label]:sr-only">
            <div className="min-w-0 flex-1">
              <SearchField label="Search chats" value={query} onValueChange={setQuery} placeholder="Search name, number, message" />
            </div>
            <Button
              variant="ghost"
              size="md"
              aria-label="Refresh chats"
              title="Refresh"
              onClick={() => void load(true)}
              disabled={refreshing}
            >
              <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
            </Button>
          </div>
          <SegmentedControl
            label="Filter chats"
            value={tab}
            onValueChange={(v) => setTab(v as InboxTab)}
            className="w-full"
            options={TABS.map(({ id, label }) => ({
              value: id,
              label,
              accessory: <span className="ml-1 tabular-nums text-ink-muted">{filtered.filter((chat) => summaryInTab(chat, id)).length}</span>,
            }))}
          />
          <div className="flex items-center gap-3">
            <LabelFilter kind="stage" title="Stage" labels={labels} value={filter.stageId} onChange={(stageId) => setFilter({ ...filter, stageId })} />
            <Switch label="Group" checked={grouped} onCheckedChange={setGrouped} />
          </div>
        </div>
        {error && <p role="alert" className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 && !historyActive ? (
            <EmptyState
              className="py-10"
              icon={<Inbox width={24} height={24} strokeWidth={1.5} />}
              title={chats.length === 0 ? (query ? "No chats match" : "No chats yet") : "Nothing here"}
              description={
                chats.length === 0
                  ? query ? "Try another name, number or word." : "New WhatsApp chats appear here as they arrive."
                  : `No ${tab === "all" ? "" : `${tab} `}chats${filtering ? " with this filter" : ""}.`
              }
            />
          ) : grouped ? (
            <div>
              {stageGroups.map((g) => {
                const open = !collapsed.has(g.id);
                return (
                  <section key={g.id || "none"}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setCollapsed((c) => { const n = new Set(c); if (open) n.add(g.id); else n.delete(g.id); return n; })}
                      className="sticky top-0 z-10 flex w-full items-center justify-between gap-2 border-b border-line bg-card/95 px-3 py-2 text-left text-xs font-semibold text-ink backdrop-blur"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ChevronRight className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
                        <span className="truncate">{g.name}</span>
                      </span>
                      <span className="tabular-nums text-ink-muted">{g.chats.length}</span>
                    </button>
                    {open && <ul className="divide-y divide-line/60">{g.chats.map(chatRow)}</ul>}
                  </section>
                );
              })}
            </div>
          ) : (
            <ul className="divide-y divide-line/60">{visible.map(chatRow)}</ul>
          )}
          {historyActive && (
            <div className="space-y-4 border-t border-line/60 p-3" aria-label="Loading historical messages">
              {[0, 1, 2].map((i) => <Skeleton key={i} avatar lines={2} label="Loading historical messages" />)}
            </div>
          )}
        </div>
      </section>

      <section className={`${active ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-wash/40`}>
        {active ? (
          <>
            {activeMessages ? (
              <WhatsappThread
                chat={{ customer: active.customer, messages: activeMessages, lastAt: active.lastAt, preview: active.preview, lastInboundAt: active.lastInboundAt }}
                name={contactName(active.name)}
                photo={transport === "gateway"}
                closedAt={active.closedAt}
                connected={connected}
                ai={transport === "dualhook" ? { enabled: active.aiEnabled ?? true, pausedReason: active.aiPausedReason ?? null } : null}
                windowRule={transport === "dualhook"}
                windowFrom={active.liveInboundAt === undefined ? active.lastInboundAt : active.liveInboundAt}
                onAiChanged={() => void load(false)}
                actions={<WhatsappPushToOrderEntry waId={active.customer} />}
                details={<div className="max-h-[60dvh] overflow-y-auto">{contactPanel}</div>}
                onBack={() => select(null)}
                onToggleClosed={(closed) => void toggleClosed(active, closed)}
                onSent={() => void loadThread(active.customer)}
              />
            ) : (
              <div className="flex-1 space-y-4 p-6" aria-busy>
                <Skeleton lines={2} label="Loading messages" />
                <Skeleton lines={3} label="Loading messages" />
              </div>
            )}
          </>
        ) : (
          <EmptyState
            className="m-auto"
            icon={<MessageCircle width={24} height={24} strokeWidth={1.5} />}
            title="Select a chat"
            description="Pick a conversation on the left to read and reply."
          />
        )}
      </section>

      <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-line xl:block">{contactPanel}</aside>
    </div>
  );
}

/** Today: time only. Older: the date. Full stamp lives in the thread. */
function shortTime(iso: string): string {
  const d = new Date(iso);
  const opts = { timeZone: "Asia/Kuala_Lumpur" } as const;
  const day = (x: Date) => x.toLocaleDateString("en-GB", opts);
  return day(d) === day(new Date())
    ? d.toLocaleTimeString("en-GB", { ...opts, hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GB", { ...opts, day: "numeric", month: "short" });
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
    <div className="relative min-w-0 flex-1">
      <label htmlFor={id} className="sr-only">{title}</label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className={`h-9 w-full appearance-none rounded-lg border bg-card pl-3 pr-8 text-sm ${value ? "border-ink text-ink" : "border-line text-ink-muted"}`}
      >
        <option value="">All {title.toLowerCase()}s</option>
        {labels.filter((l) => l.kind === kind).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
    </div>
  );
}
