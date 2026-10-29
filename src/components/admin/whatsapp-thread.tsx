"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, CheckCheck, FileText, Info, SendHorizontal } from "lucide-react";
import { Button } from "@/components/arc/components/button/button";
import { Switch } from "@/components/arc/components/switch/switch";
import { ContactAvatar } from "@/components/admin/whatsapp-avatar";
import { toast } from "@/lib/toast";
import { sendWhatsappText, setWhatsappAi } from "@/actions/whatsapp";
import { windowOpen } from "@/lib/dualhook-window";
import { isClosed, type InboxChat, type InboxMessage } from "@/lib/whatsapp-inbox";
import { formatKualaLumpur } from "@/lib/whatsapp-webhook";

export function WhatsappThread({
  chat,
  name,
  photo = false,
  closedAt,
  connected,
  ai,
  windowRule,
  onAiChanged,
  actions,
  details,
  onBack,
  onToggleClosed,
  onSent,
}: {
  chat: InboxChat;
  name?: string | null;
  /** A profile photo can exist (QR gateway only). */
  photo?: boolean;
  closedAt: string | null;
  /** The linked WhatsApp number is online; sending needs it. */
  connected: boolean;
  /** Claude auto-reply state for this chat; null when the number is not on Dualhook. */
  ai?: { enabled: boolean; pausedReason: string | null } | null;
  /** Meta's 24-hour rule applies (Dualhook): no free-form send after 24h. */
  windowRule?: boolean;
  onAiChanged?: () => void;
  actions?: React.ReactNode;
  /** Contact details, shown behind an Info button where the side panel does not fit. */
  details?: React.ReactNode;
  onBack: () => void;
  onToggleClosed: (closed: boolean) => void;
  onSent: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const closed = isClosed(chat.lastInboundAt, closedAt);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.customer, chat.messages.length]);

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line bg-card px-3 py-2.5">
        <span className="md:hidden">
          <Button variant="ghost" size="md" aria-label="Back to chats" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
        </span>
        <ContactAvatar waId={chat.customer} name={name ?? null} photo={photo} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">{name ?? `+${chat.customer}`}</h2>
          {name && <p className="truncate text-xs tabular-nums text-ink-muted">+{chat.customer}</p>}
        </div>
        {details && (
          <span className="xl:hidden">
            <Button variant="ghost" size="md" aria-label="Contact details" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
              <Info className="size-4" aria-hidden />
            </Button>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-card px-3 py-2">
        {ai && <AiToggle waId={chat.customer} ai={ai} onChanged={onAiChanged} />}
        <span className="ml-auto" />
        {actions}
        <Button variant="secondary" size="sm" onClick={() => onToggleClosed(!closed)}>
          {closed ? "Reopen" : "Close chat"}
        </Button>
      </div>
      {showDetails && details && <div className="border-b border-line bg-card xl:hidden">{details}</div>}

      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-5">
        {chat.messages.map((message, i) => {
          const day = dayLabel(message.at);
          return (
            <div key={message.id}>
              {(i === 0 || dayLabel(chat.messages[i - 1].at) !== day) && (
                <p className="my-3 text-center">
                  <span className="rounded-full border border-line bg-card px-2.5 py-0.5 text-[11px] font-medium text-ink-muted">{day}</span>
                </p>
              )}
              <Bubble message={message} />
            </div>
          );
        })}
      </div>

      <Composer
        key={chat.customer}
        to={chat.customer}
        connected={connected}
        windowClosed={windowRule === true && !windowOpen(chat.lastInboundAt)}
        onSent={onSent}
      />
    </>
  );
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric" });
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit" });
}

function Bubble({ message }: { message: InboxMessage }) {
  const business = message.side === "echo";
  return (
    <div className={`flex ${business ? "justify-end" : "justify-start"}`}>
      <div
        title={formatKualaLumpur(message.at)}
        className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${business ? "rounded-br-md bg-ink text-white" : "rounded-bl-md border border-line bg-card text-ink"}`}
      >
        <span className="sr-only">{business ? "Business" : "Customer"}</span>
        {message.media && <Media media={message.media} />}
        <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
        <p className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${business ? "text-white/70" : "text-ink-muted"}`}>
          {message.byAi ? <span className="font-semibold">AI ·</span> : message.fromBizzflow && <span>BizzFlow ·</span>}
          {clock(message.at)}
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
  if (media.kind === "audio") {
    return <audio controls preload="none" src={src} className="mb-1 max-w-full" aria-label="Voice message from the customer" />;
  }
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

const PAUSED: Record<string, string> = {
  human: "paused: a person replied",
  documents: "paused: documents received",
  admin: "off",
};

function AiToggle({ waId, ai, onChanged }: { waId: string; ai: { enabled: boolean; pausedReason: string | null }; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const res = await setWhatsappAi(waId, !ai.enabled);
    setBusy(false);
    if (!res.success) toast.error(res.error);
    else toast.success(ai.enabled ? "AI replies turned off for this chat." : "AI replies turned on for this chat.");
    onChanged?.();
  }
  return (
    <div className="flex items-center gap-2" title={ai.enabled ? "Claude answers this chat." : "Turn on to let Claude answer this chat again."}>
      <Switch label="AI replies" checked={ai.enabled} disabled={busy} onCheckedChange={() => void toggle()} />
      {!ai.enabled && <span className="text-xs text-ink-muted">{PAUSED[ai.pausedReason ?? "admin"] ?? "off"}</span>}
    </div>
  );
}

function Composer({ to, connected, windowClosed, onSent }: { to: string; connected: boolean; windowClosed: boolean; onSent: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!text.trim() || sending || !connected || windowClosed) return;
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

  const blocked = !connected || windowClosed;
  return (
    <div className="border-t border-line bg-card p-3">
      {!connected && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">WhatsApp is not connected. Scan the QR above to reply.</p>
      )}
      {windowClosed && (
        <p role="status" className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The customer&apos;s last message is more than 24 hours old. WhatsApp only allows a reply from the phone app until they write again.
        </p>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
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
              void send();
            }
          }}
          rows={1}
          maxLength={4096}
          disabled={blocked}
          placeholder={blocked ? "Replies are off for this chat" : "Type a reply"}
          className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-wash/60 px-4 py-2.5 text-sm text-ink [field-sizing:content] placeholder:text-ink-muted focus:border-ink focus:bg-card focus:outline-none disabled:opacity-60"
        />
        <Button type="submit" size="md" aria-label="Send" loading={sending} disabled={sending || !text.trim() || blocked}>
          <SendHorizontal className="size-4" aria-hidden />
        </Button>
      </form>
      <p className="mt-1.5 hidden text-[11px] text-ink-muted sm:block">Enter sends · Shift+Enter for a new line</p>
    </div>
  );
}
