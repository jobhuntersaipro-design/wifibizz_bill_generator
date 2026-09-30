"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle, RotateCcw, Send, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { parseChatMarkdown, type Block, type Inline } from "@/lib/admin-chat/markdown";
import { listChatHandoffs, resolveChatHandoff, type HandoffRow } from "@/actions/admin-chat";

/**
 * The admin assistant popup — a testing feature, read-only.
 *
 * Mounted once in AdminShell, so the conversation survives moving between
 * admin pages. A reload starts a new chat; the old one stays in the database.
 */

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** A tool is running ("Reading the order…"). Cleared by the next text. */
  status?: string;
  handoff?: string;
  error?: boolean;
}

const SUGGESTIONS = [
  "Which orders failed today, and why?",
  "What plans are published at 500Mbps?",
  "Is anything stuck on the submit server right now?",
  "Which agent has the most failures this week?",
];

export function AdminChat({ handoffName }: { handoffName: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "handoffs">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffRow[] | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToEnd = () =>
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });

  /** Update the assistant message being streamed (always the last one). */
  const patchLast = (fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((list) => {
      if (list.length === 0) return list;
      const copy = list.slice();
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });

  async function loadHandoffs() {
    const res = await listChatHandoffs();
    setHandoffs(res.data);
    // Shown in the tab rather than toasted: an empty list must not pass for
    // "nothing open" when the list simply could not be read.
    setHandoffError(res.success ? null : res.error ?? "Could not load handoffs.");
  }

  function openPanel() {
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
    void loadHandoffs();
  }

  function newChat() {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setLocked(null);
    setBusy(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || locked) return;
    setInput("");
    setBusy(true);
    setMessages((list) => [...list, { role: "user", text }, { role: "assistant", text: "" }]);
    scrollToEnd();

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        const msg = err?.error ?? `The assistant answered ${res.status}.`;
        if (res.status === 423) setLocked(msg);
        patchLast((m) => ({ ...m, text: msg, error: true }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) handleEvent(JSON.parse(line) as Record<string, string>);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        patchLast((m) => ({ ...m, text: m.text || "Could not reach the assistant.", error: !m.text }));
      }
    } finally {
      setBusy(false);
      patchLast((m) => ({ ...m, status: undefined }));
      scrollToEnd();
    }
  }

  function handleEvent(ev: Record<string, string>) {
    switch (ev.type) {
      case "conversation":
        setConversationId(ev.id);
        break;
      case "status":
        patchLast((m) => ({ ...m, status: ev.text }));
        break;
      case "text":
        patchLast((m) => ({ ...m, text: m.text + ev.delta, status: undefined }));
        scrollToEnd();
        break;
      case "handoff":
        patchLast((m) => ({ ...m, handoff: ev.assignee }));
        void loadHandoffs();
        break;
      case "locked":
        setLocked(ev.message);
        break;
      case "error":
        patchLast((m) => ({ ...m, text: m.text ? `${m.text}\n\n${ev.message}` : ev.message, error: !m.text }));
        break;
    }
  }

  async function resolve(id: string) {
    const res = await resolveChatHandoff(id);
    if (!res.success) {
      toast.error(res.error ?? "Could not resolve.");
      return;
    }
    setHandoffs((list) => list?.filter((h) => h.id !== id) ?? null);
  }

  const openCount = handoffs?.length ?? 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        aria-label="Open admin assistant"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#635BFF] text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-label="Admin assistant"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
      className="fixed inset-0 z-50 flex flex-col bg-white md:inset-auto md:bottom-5 md:right-5 md:h-[600px] md:max-h-[calc(100vh-2.5rem)] md:w-[400px] md:rounded-xl md:border md:border-[#E3E8EF] md:shadow-2xl"
    >
      <header className="flex items-center gap-2 border-b border-[#E3E8EF] px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[#0A2540]">Admin assistant</h2>
          <p className="text-[11px] text-[#697386]">Testing · read-only · answers from BizzFlow data</p>
        </div>
        <button
          type="button"
          onClick={newChat}
          aria-label="New chat"
          title="New chat"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[#697386] hover:bg-[#F6F9FC] focus-visible:outline-2 focus-visible:outline-[#635BFF]"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close admin assistant"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-[#697386] hover:bg-[#F6F9FC] focus-visible:outline-2 focus-visible:outline-[#635BFF]"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div role="tablist" className="flex border-b border-[#E3E8EF] px-3 text-sm">
        {(["chat", "handoffs"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              if (t === "handoffs") void loadHandoffs();
            }}
            className={`-mb-px min-h-11 border-b-2 px-3 font-medium ${
              tab === t ? "border-[#635BFF] text-[#0A2540]" : "border-transparent text-[#697386] hover:text-[#0A2540]"
            }`}
          >
            {t === "chat" ? "Chat" : `Handoffs${openCount ? ` (${openCount})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "chat" ? (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-[#697386]">
                  Ask about orders, failures, plans or agents. I can&apos;t change anything — for that, I hand off to{" "}
                  {handoffName}.
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void ask(s)}
                    className="block w-full rounded-lg border border-[#E3E8EF] px-3 py-2 text-left text-sm text-[#0A2540] hover:border-[#635BFF] hover:bg-[#F6F9FC]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))}
          </div>

          <form
            className="border-t border-[#E3E8EF] p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            {locked && <p className="mb-2 rounded-md bg-[#FFF4E5] px-2 py-1.5 text-xs text-[#9A4B00]">{locked}</p>}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(input);
                  }
                }}
                rows={1}
                maxLength={1000}
                disabled={!!locked}
                placeholder={locked ? "Locked" : "Ask about an order, plan or agent…"}
                aria-label="Your question"
                className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-[#E3E8EF] px-3 py-2.5 text-sm text-[#0A2540] placeholder:text-[#A3ACB9] focus:border-[#635BFF] focus:outline-none disabled:bg-[#F6F9FC]"
              />
              <button
                type="submit"
                disabled={busy || !input.trim() || !!locked}
                aria-label="Send"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#635BFF] text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </form>
        </>
      ) : (
        <HandoffList rows={handoffs} error={handoffError} onResolve={resolve} />
      )}
    </section>
  );
}

function MessageBubble({ message: m }: { message: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="ml-10 rounded-lg bg-[#635BFF] px-3 py-2 text-sm whitespace-pre-wrap text-white">{m.text}</div>
    );
  }
  return (
    <div className="mr-6 space-y-2">
      {m.text ? (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            m.error ? "bg-[#FDECEC] text-[#9B1C1C]" : "bg-[#F6F9FC] text-[#0A2540]"
          }`}
        >
          <ChatText blocks={parseChatMarkdown(m.text)} />
        </div>
      ) : null}
      {(m.status || !m.text) && !m.error && (
        <p className="flex items-center gap-2 text-xs text-[#697386]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {m.status ?? "Thinking…"}
        </p>
      )}
      {m.handoff && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-[#0A7B3E]">
          <UserRound className="h-3.5 w-3.5" />
          Handed off to {m.handoff}
        </p>
      )}
    </div>
  );
}

function ChatText({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        b.kind === "para" ? (
          <p key={i}>
            <InlineParts parts={b.parts} />
          </p>
        ) : b.ordered ? (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>
                <InlineParts parts={it} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((it, j) => (
              <li key={j}>
                <InlineParts parts={it} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function InlineParts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => {
        switch (p.kind) {
          case "bold":
            return <strong key={i} className="font-semibold">{p.text}</strong>;
          case "code":
            return (
              <code key={i} className="rounded bg-white px-1 font-mono text-[12px]">
                {p.text}
              </code>
            );
          case "link":
            return (
              <Link key={i} href={p.href} className="font-medium text-[#635BFF] underline-offset-2 hover:underline">
                {p.text}
              </Link>
            );
          default:
            return <span key={i}>{p.text}</span>;
        }
      })}
    </>
  );
}

function HandoffList({
  rows,
  error,
  onResolve,
}: {
  rows: HandoffRow[] | null;
  error: string | null;
  onResolve: (id: string) => void;
}) {
  if (error) {
    return <p className="flex-1 px-3 py-6 text-center text-sm text-[#9B1C1C]">{error}</p>;
  }
  if (rows === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[#697386]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="flex-1 px-3 py-6 text-center text-sm text-[#697386]">No open handoffs.</p>;
  }
  return (
    <ul className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
      {rows.map((h) => (
        <li key={h.id} className="rounded-lg border border-[#E3E8EF] p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-[#697386]">
                To {h.assignee}
                {h.orderRef ? ` · ${h.orderRef}` : ""} · {new Date(h.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "short", timeStyle: "short" })}
                {h.emailed ? " · e-mailed" : " · not e-mailed"}
              </p>
              <p className="mt-1 text-[#0A2540]">{h.summary}</p>
              <p className="mt-1 text-xs text-[#697386]">Why: {h.reason}</p>
            </div>
            <button
              type="button"
              onClick={() => onResolve(h.id)}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#0A7B3E] hover:bg-[#F6F9FC]"
            >
              <CheckCircle2 className="h-4 w-4" /> Resolve
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
