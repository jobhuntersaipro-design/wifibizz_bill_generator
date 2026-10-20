"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CheckCheck, FileText } from "lucide-react";
import { toast } from "@/lib/toast";
import { sendWhatsappText } from "@/actions/whatsapp";
import { isClosed, type InboxChat, type InboxMessage } from "@/lib/whatsapp-inbox";
import { formatKualaLumpur } from "@/lib/whatsapp-webhook";

export function WhatsappThread({
  chat,
  name,
  closedAt,
  connected,
  onBack,
  onToggleClosed,
  onSent,
}: {
  chat: InboxChat;
  name?: string | null;
  closedAt: string | null;
  /** The linked WhatsApp number is online; sending needs it. */
  connected: boolean;
  onBack: () => void;
  onToggleClosed: (closed: boolean) => void;
  onSent: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const closed = isClosed(chat.lastInboundAt, closedAt);

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
        <h2 className="min-w-0 truncate text-sm font-medium text-ink">
          {name ? <>{name} <span className="font-mono font-normal text-ink-muted">+{chat.customer}</span></> : <span className="font-mono">{chat.customer}</span>}
        </h2>
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

      <Composer key={chat.customer} to={chat.customer} connected={connected} onSent={onSent} />
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
          {message.fromBizzflow && <span>BizzFlow ·</span>}
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

function Composer({ to, connected, onSent }: { to: string; connected: boolean; onSent: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!text.trim() || sending || !connected) return;
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

  return (
    <div className="border-t border-line p-3">
      {!connected && (
        <p className="mb-2 text-xs text-amber-700">WhatsApp is not connected. Scan the QR above to reply.</p>
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
          rows={2}
          maxLength={4096}
          placeholder="Type a reply. Enter sends, Shift+Enter for a new line."
          className="min-h-11 flex-1 resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted"
        />
        <button
          type="submit"
          disabled={sending || !text.trim() || !connected}
          className="min-h-11 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
