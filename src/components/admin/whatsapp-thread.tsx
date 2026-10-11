"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CheckCheck, FileText } from "lucide-react";
import { toast } from "@/lib/toast";
import { getWhatsappTemplates, sendWhatsappTemplate, sendWhatsappText } from "@/actions/whatsapp";
import { formatRemaining, isClosed, windowClosesAt, type InboxChat, type InboxMessage } from "@/lib/whatsapp-inbox";
import { formatKualaLumpur } from "@/lib/whatsapp-webhook";
import type { TemplateView } from "@/lib/whatsapp-send";

export function WhatsappThread({
  chat,
  closedAt,
  now,
  onBack,
  onToggleClosed,
  onSent,
}: {
  chat: InboxChat;
  closedAt: string | null;
  /** 0 until the client clock is known, so the server render shows no countdown. */
  now: number;
  onBack: () => void;
  onToggleClosed: (closed: boolean) => void;
  onSent: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const closed = isClosed(chat.lastInboundAt, closedAt);
  const closesAt = windowClosesAt(chat.lastInboundAt);
  const remaining = closesAt && now > 0 ? Date.parse(closesAt) - now : null;
  const windowOpen = remaining !== null && remaining > 0;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.customer, chat.messages.length]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-lg px-2 text-sm font-medium text-ink hover:bg-wash md:hidden"
        >
          Chats
        </button>
        <h2 className="font-mono text-sm font-medium text-ink">{chat.customer}</h2>
        {now > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${windowOpen ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
            title="WhatsApp allows free-form replies for 24 hours after the customer's last message."
          >
            {windowOpen && remaining !== null ? `Reply window · ${formatRemaining(remaining)} left` : "Window closed · templates only"}
          </span>
        )}
        <button
          type="button"
          onClick={() => onToggleClosed(!closed)}
          className="ml-auto min-h-11 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-wash"
        >
          {closed ? "Reopen" : "Close chat"}
        </button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {chat.messages.map((message) => <Bubble key={message.id} message={message} />)}
      </div>

      <Composer key={chat.customer} to={chat.customer} windowOpen={windowOpen} clockKnown={now > 0} onSent={onSent} />
    </>
  );
}

function Bubble({ message }: { message: InboxMessage }) {
  const business = message.side === "echo";
  return (
    <div className={`flex ${business ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 ${business ? "bg-ink text-white" : "bg-wash text-ink"}`}>
        <span className="sr-only">{business ? "Business" : "Customer"}</span>
        {message.media && <Media media={message.media} />}
        <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
        <p className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${business ? "text-white/70" : "text-ink-muted"}`}>
          {formatKualaLumpur(message.at)}
          {business && <Tick status={message.status} />}
        </p>
        {message.status === "failed" && (
          <p className="mt-1 text-[11px] text-red-200">{message.error ?? "Not delivered."}</p>
        )}
      </div>
    </div>
  );
}

function Tick({ status }: { status: InboxMessage["status"] }) {
  if (!status) return null;
  const label = { sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed" }[status];
  const icon =
    status === "failed" ? <AlertCircle className="size-3.5 text-red-300" aria-hidden />
    : status === "sent" ? <Check className="size-3.5" aria-hidden />
    : <CheckCheck className={`size-3.5 ${status === "read" ? "text-sky-300" : ""}`} aria-hidden />;
  return <span title={label} className="inline-flex">{icon}<span className="sr-only">{label}</span></span>;
}

function Media({ media }: { media: NonNullable<InboxMessage["media"]> }) {
  const src = `/api/admin/whatsapp/media?id=${encodeURIComponent(media.id)}`;
  if (media.kind === "image") {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="mb-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated proxy, not an optimisable asset */}
        <img
          src={src}
          alt="Attachment from the customer"
          loading="lazy"
          onError={(event) => { event.currentTarget.hidden = true; }}
          className="max-h-64 rounded-md bg-white object-contain"
        />
      </a>
    );
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="mb-1 inline-flex items-center gap-1 text-sm font-medium underline">
      <FileText className="size-4" aria-hidden /> Open document
    </a>
  );
}

function Composer({
  to,
  windowOpen,
  clockKnown,
  onSent,
}: {
  to: string;
  windowOpen: boolean;
  clockKnown: boolean;
  onSent: () => void;
}) {
  const [mode, setMode] = useState<"text" | "template">("text");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<TemplateView[] | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string>("");

  const requested = useRef(false);

  const effectiveMode = clockKnown && !windowOpen ? "template" : mode;

  // Loaded once per open chat, the first time the template picker shows.
  useEffect(() => {
    if (effectiveMode !== "template" || requested.current) return;
    requested.current = true;
    void getWhatsappTemplates().then((res) => {
      if (res.success) setTemplates(res.data);
      else setTemplateError(res.error);
    });
  }, [effectiveMode]);

  function chooseMode(next: "text" | "template") {
    setMode(next);
  }

  async function sendTextNow() {
    if (!text.trim() || sending) return;
    setSending(true);
    const res = await sendWhatsappText(to, text);
    setSending(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setText("");
    onSent();
  }

  async function sendTemplateNow() {
    const template = templates?.find((t) => `${t.name}|${t.language}` === picked);
    if (!template || sending) return;
    setSending(true);
    const res = await sendWhatsappTemplate(to, template.name, template.language);
    setSending(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setPicked("");
    onSent();
  }

  const chosen = templates?.find((t) => `${t.name}|${t.language}` === picked) ?? null;

  return (
    <div className="border-t border-line p-3">
      <div className="mb-2 flex items-center gap-1" role="group" aria-label="Reply type">
        {(["text", "template"] as const).map((id) => {
          const disabled = id === "text" && clockKnown && !windowOpen;
          const on = effectiveMode === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => chooseMode(id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${on ? "bg-ink text-white" : "text-ink-muted hover:text-ink"} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {id === "text" ? "Message" : "Template"}
            </button>
          );
        })}
        {clockKnown && !windowOpen && (
          <span className="text-xs text-ink-muted">The customer has not written in 24 hours, so only an approved template can be sent.</span>
        )}
      </div>

      {effectiveMode === "text" ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendTextNow();
          }}
        >
          <label htmlFor="whatsapp-reply" className="sr-only">Reply</label>
          <textarea
            id="whatsapp-reply"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void sendTextNow();
              }
            }}
            rows={2}
            maxLength={4096}
            placeholder="Type a reply. Enter sends, Shift+Enter for a new line."
            className="min-h-11 flex-1 resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="min-h-11 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      ) : (
        <div className="space-y-2">
          {templateError ? (
            <p className="text-sm text-danger">{templateError}</p>
          ) : !templates ? (
            <p className="text-sm text-ink-muted">Loading templates…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-ink-muted">No approved templates without variables. Create one in 360dialog.</p>
          ) : (
            <>
              <label htmlFor="whatsapp-template" className="sr-only">Template</label>
              <div className="flex items-end gap-2">
                <select
                  id="whatsapp-template"
                  value={picked}
                  onChange={(event) => setPicked(event.target.value)}
                  className="min-h-11 flex-1 rounded-lg border border-line bg-white px-3 text-sm text-ink"
                >
                  <option value="">Choose a template</option>
                  {templates.map((t) => (
                    <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                      {t.name} ({t.language})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void sendTemplateNow()}
                  disabled={sending || !chosen}
                  className="min-h-11 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  {sending ? "Sending…" : "Send template"}
                </button>
              </div>
              {chosen && <p className="whitespace-pre-wrap rounded-lg bg-wash px-3 py-2 text-sm text-ink">{chosen.body}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
