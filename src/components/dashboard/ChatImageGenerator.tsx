"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { toPng } from "html-to-image";
import type { CaseRow } from "./shared";
import { CloseIcon, DownloadIcon } from "./icons";
import {
  buildConversationChatScript,
  type ChatScriptVariant,
} from "@/lib/chat-script";
import { decodeCustomerName } from "@/lib/html-entities";
import { buildBizzChatScript } from "@/lib/bizz-chat-script";

function formatMobileDisplay(mobile: string | null): string {
  if (!mobile) return "";
  const cleaned = mobile.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("+60")) {
    const rest = cleaned.slice(3);
    // +6011x-xxxx xxxx format (10 digits after +60, e.g. 01119131715)
    if (rest.length === 10 && rest.startsWith("11")) {
      return `+60 ${rest.slice(0, 2)}-${rest.slice(2, 6)} ${rest.slice(6)}`;
    }
    // +60 1x-xxx xxxx format (9 digits after +60, e.g. 0109131715)
    if (rest.length === 9) {
      return `+60 ${rest.slice(0, 2)}-${rest.slice(2, 5)} ${rest.slice(5)}`;
    }
    // 10-digit non-011 numbers: +60 1x-xxx xxxx
    if (rest.length === 10) {
      return `+60 ${rest.slice(0, 2)}-${rest.slice(2, 5)} ${rest.slice(5)}`;
    }
  }
  return mobile;
}

function getTimeString(): string {
  const h = 10 + Math.floor(Math.random() * 6);
  const m = Math.floor(Math.random() * 60);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h > 12 ? h - 12 : h;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Renders text with URLs styled as blue links and WhatsApp *bold* markup emboldened
function TextWithLinks({ text, style }: { text: string; style?: React.CSSProperties }) {
  const parts = text.split(/(https?:\/\/[^\s]+|\*[^*]+\*)/g);
  return (
    <span style={style}>
      {parts.map((part, i) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <span key={i} style={{ color: "#53BDEB", textDecoration: "underline" }}>{part}</span>
          );
        }
        if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
          return <span key={i} style={{ fontWeight: 700 }}>{part.slice(1, -1)}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

// Everything that differs between the two chats, in one row per variant, so the
// chrome and the modal read from it instead of branching on the variant.
const CHAT_VARIANTS: Record<
  ChatScriptVariant,
  {
    build: (c: CaseRow, installOffsetDays: number) => ReturnType<typeof buildConversationChatScript>;
    /** Follows the case number in the modal header. */
    kind: (c: CaseRow) => string;
    /** Prefix of the downloaded PNG's filename. */
    filePrefix: string;
  }
> = {
  conversation: {
    build: buildConversationChatScript,
    kind: () => "Home",
    filePrefix: "closing_script",
  },
  bizz: {
    build: buildBizzChatScript,
    kind: () => "Bizz",
    filePrefix: "bizz_chat",
  },
};

// WhatsApp iPhone dark mode wallpaper colors
const WA_WALLPAPERS = [
  "#0B141A", // default dark (dark charcoal)
  "#0D1418", // midnight
  "#122229", // dark teal
  "#172D21", // dark forest green
  "#1B2D2A", // deep sea green
  "#1C2733", // navy slate
  "#1F1A27", // dark purple
  "#1A1F2E", // deep indigo
  "#22181C", // dark burgundy
  "#1E1B14", // dark brown/umber
  "#141E1E", // dark cyan
  "#0E1621", // deep blue-black
];

function pickWallpaper(): string {
  return WA_WALLPAPERS[Math.floor(Math.random() * WA_WALLPAPERS.length)];
}

interface ChatRandomization {
  wallpaper: string;
  time: string;
  unreadCount: number;
  installOffsetDays: number;
}

// Generates all randomized display values together. Called outside render
// (lazy state init / event handlers) so the component tree stays pure.
export function makeRandomization(): ChatRandomization {
  return {
    wallpaper: pickWallpaper(),
    time: getTimeString(),
    unreadCount: 10 + Math.floor(Math.random() * 30),
    installOffsetDays: 3 + Math.floor(Math.random() * 5), // 3-7 days
  };
}

const S = {
  text: { color: "#E9EDEF", fontSize: 14.2, lineHeight: 1.4 } as React.CSSProperties,
  muted: { color: "#8696A0" } as React.CSSProperties,
};

export function WhatsAppChat({
  caseData,
  wallpaper,
  time,
  unreadCount,
  installOffsetDays,
  variant = "conversation",
}: {
  caseData: CaseRow;
  wallpaper: string;
  time: string;
  unreadCount: number;
  installOffsetDays: number;
  variant?: ChatScriptVariant;
}) {
  const script = CHAT_VARIANTS[variant].build(caseData, installOffsetDays);
  const mobileDisplay = formatMobileDisplay(caseData.mobile);

  return (
    <div
      style={{
        width: 414,
        backgroundColor: wallpaper,
        fontFamily: "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
        padding: 0,
        margin: 0,
      }}
    >
      {/* WhatsApp top navigation bar */}
      <div
        style={{
          backgroundColor: "#1F2C34",
          padding: "6px 10px 10px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {/* Back arrow + unread count */}
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#E9EDEF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span style={{ color: "#E9EDEF", fontSize: 12, fontWeight: 600, marginLeft: -2 }}>{unreadCount}</span>
        </div>
        {/* Profile avatar */}
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            backgroundColor: "#2A3942",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#6B7B8A">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
        </div>
        {/* Contact name/number */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#E9EDEF", fontSize: 17, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {mobileDisplay || decodeCustomerName(caseData.full_name) || "Customer"}
          </div>
        </div>
        {/* Action icons */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Video call */}
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#8696A0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m16 2 5 5-5 5" />
            <path d="M21 7H9" />
            <path d="m8 22-5-5 5-5" />
            <path d="M3 17h12" />
          </svg>
          {/* Voice call */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8696A0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          {/* Kebab menu */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#8696A0">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </div>
      </div>

      {/* Chat area */}
      <div
        style={{
          backgroundColor: wallpaper,
          padding: "8px 10px 14px",
          minHeight: 100,
        }}
      >
        {/* Incoming message bubble — left aligned, dark gray */}
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <div
            style={{
              backgroundColor: "#202C33",
              borderRadius: "0 7.5px 7.5px 7.5px",
              padding: "5px 7px 3px",
              maxWidth: 350,
              position: "relative",
            }}
          >
            {/* Bubble tail / notch (top-left) */}
            <div style={{
              position: "absolute",
              top: 0,
              left: -8,
              width: 0,
              height: 0,
              borderTop: "0 solid transparent",
              borderRight: "8px solid #202C33",
              borderBottom: "10px solid transparent",
            }} />

            {script.heading && (
              <div style={{ ...S.text }}>{script.heading}</div>
            )}

            {/* Script lines */}
            <div style={{ ...S.text }}>
              {script.lines.map((line, i) => {
                // Email address on its own line (the blank label line for email value)
                if (line.label === "" && line.value) {
                  return (
                    <div key={i}>
                      <span style={{ color: "#53BDEB", textDecoration: "underline" }}>{line.value}</span>
                    </div>
                  );
                }
                // "4.Email Address :" with no inline value
                if (line.label && line.value === "") {
                  return <div key={i}>{line.label}</div>;
                }
                // Normal field: label + value on same line, value wraps naturally
                return (
                  <div key={i}>
                    <span>{line.label}</span>
                    {line.value && <span>{line.value}</span>}
                  </div>
                );
              })}
            </div>

            {/* Terms header */}
            <div style={{ ...S.text, marginTop: 2 }}>
              Terms & Conditions:
            </div>

            {/* T&C items with green checkmarks.
                INLINE, not one flex row per clause, because of how the PNG is
                rasterised: html-to-image copies each element's measured height
                onto its clone but re-lays the text out, and the raster fits
                slightly more per line than the DOM does. A clause whose last DOM
                line held one orphan word rasterised a line shorter than the box
                reserved for it, and the spare line showed as a blank gap between
                two clauses (seen live between the advance-payment clause and the
                one after it, and again before the final authorisation clause).
                A non-replaced inline element's computed height is `auto`, so
                nothing is reserved and the raster's own wrap decides the height.
                Wrapped lines now return to the left margin instead of hanging
                under the text — which is what real WhatsApp does anyway. */}
            <div style={{ ...S.text }}>
              {script.terms.map((term, i) => (
                <span key={i}>
                  <span style={{ fontSize: 14.2, lineHeight: 1.4 }}>✅ </span>
                  <TextWithLinks text={term} style={S.text} />
                  {i < script.terms.length - 1 && <br />}
                </span>
              ))}
            </div>

            {script.consent && (
              <div style={{ ...S.text, marginTop: 14 }}>{script.consent}</div>
            )}

            <div style={{ ...S.text, fontWeight: 700, marginTop: 14 }}>
              {script.agreement}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: 2, paddingRight: 2 }}>
              <span style={{ color: "#8696A0", fontSize: 11 }}>{time}</span>
            </div>
          </div>
        </div>
      </div>

      {/* iPhone WhatsApp bottom input bar */}
      <div
        style={{
          backgroundColor: "#1F2C34",
          padding: "8px 10px 6px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 50,
        }}
      >
        {/* Plus circle button */}
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            backgroundColor: "#3B4A54",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8696A0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        {/* Input field — iPhone style rounded pill */}
        <div
          style={{
            flex: 1,
            backgroundColor: "#2A3942",
            borderRadius: 18,
            height: 34,
            padding: "0 8px 0 14px",
            display: "flex",
            alignItems: "center",
            gap: 0,
          }}
        >
          <span style={{ flex: 1, color: "#8696A0", fontSize: 16, lineHeight: "34px" }}>Message</span>
          {/* Emoji icon */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8696A0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: 4 }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
          {/* Camera icon */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8696A0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
        </div>
        {/* Mic icon */}
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            backgroundColor: "#3B4A54",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8696A0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </div>
      </div>
      {/* iPhone home indicator bar */}
      <div style={{ backgroundColor: "#1F2C34", padding: "4px 0 8px", display: "flex", justifyContent: "center" }}>
        <div style={{ width: 134, height: 5, borderRadius: 3, backgroundColor: "#8696A0" }} />
      </div>
    </div>
  );
}

interface ChatImageGeneratorProps {
  caseData: CaseRow;
  onClose: () => void;
  variant?: ChatScriptVariant;
}

export default function ChatImageGenerator({ caseData, onClose, variant = "conversation" }: ChatImageGeneratorProps) {
  const chat = CHAT_VARIANTS[variant];
  const chatRef = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState({ width: 414, height: 0 });
  const [generating, setGenerating] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [rand, setRand] = useState(makeRandomization);

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const generateImage = useCallback(async () => {
    if (!chatRef.current) return;
    setGenerating(true);
    try {
      const node = chatRef.current;
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: rand.wallpaper,
      });
      setImageDims({ width: node.offsetWidth, height: node.offsetHeight });
      setImageUrl(dataUrl);
    } catch (err) {
      console.error("Failed to generate chat image:", err);
    } finally {
      setGenerating(false);
    }
  }, [rand.wallpaper]);

  // Auto-generate on mount and when the randomization (wallpaper) changes
  useEffect(() => {
    const timer = setTimeout(generateImage, 150);
    return () => clearTimeout(timer);
  }, [generateImage]);

  function handleDownload() {
    if (!imageUrl) return;
    const link = document.createElement("a");
    link.download = `${chat.filePrefix}_${caseData.case_no}.png`;
    link.href = imageUrl;
    link.click();
  }

  function handleClose() {
    setIsVisible(false);
    setTimeout(onClose, 300);
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-colors duration-300 ${isVisible ? "bg-black/40" : "bg-transparent"}`}
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-[#E3E8EF] w-full max-w-lg mx-4 max-h-[90vh] flex flex-col"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "translateY(0) scale(1)" : "translateY(16px) scale(0.97)",
          transition: "opacity 300ms ease-out, transform 300ms ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E3E8EF]">
          <div>
            <h3 className="text-sm font-semibold text-[#0A2540]">Closing Script</h3>
            <p className="text-xs text-[#697386] mt-0.5">
              {caseData.case_no} &middot; {chat.kind(caseData)}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F6F9FC] text-[#697386] hover:text-[#0A2540] transition-colors"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Hidden render target */}
          <div style={{ position: "absolute", left: -9999, top: -9999 }}>
            <div ref={chatRef}>
              <WhatsAppChat
                caseData={caseData}
                wallpaper={rand.wallpaper}
                time={rand.time}
                unreadCount={rand.unreadCount}
                installOffsetDays={rand.installOffsetDays}
                variant={variant}
              />
            </div>
          </div>

          {/* Preview */}
          {generating && (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
              <span className="text-sm text-[#697386]">Generating image...</span>
            </div>
          )}
          {imageUrl && !generating && (
            <div className="rounded-lg overflow-hidden border border-[#E3E8EF] bg-[#0B141A]">
              <Image
                src={imageUrl}
                alt={`Closing script for case ${caseData.case_no}`}
                width={imageDims.width}
                height={imageDims.height}
                unoptimized
                className="w-full h-auto"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-[#E3E8EF]">
          <button
            onClick={() => setRand(makeRandomization())}
            disabled={generating}
            className="flex items-center gap-2 px-4 h-9 rounded-lg border border-[#E3E8EF] text-sm font-medium text-[#425466] hover:text-[#0A2540] hover:border-[#635BFF] transition-all disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
            Regenerate
          </button>
          <button
            onClick={handleDownload}
            disabled={!imageUrl || generating}
            className="flex items-center gap-2 px-4 h-9 rounded-lg bg-[#635BFF] hover:bg-[#5851DB] text-white text-sm font-medium transition-all disabled:opacity-50 ml-auto"
          >
            <DownloadIcon className="w-4 h-4" />
            Download PNG
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
