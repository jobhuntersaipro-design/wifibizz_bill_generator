/**
 * The small markdown subset the chat panel renders: paragraphs, "-" / "*" /
 * "1." list items, **bold**, `code` and [links](href).
 *
 * Parsed into tokens, never into HTML, so model output can never inject markup.
 * A link is only a link when it points inside /admin/ — anything else (an
 * external URL, javascript:, a protocol-relative //host) renders as its text.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "para"; parts: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

export function isSafeAdminHref(href: string): boolean {
  return /^\/admin(\/[A-Za-z0-9._~\-/?=&%]*)?$/.test(href) && !href.startsWith("//");
}

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: line.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else if (m[3] !== undefined && m[4] !== undefined) {
      out.push(
        isSafeAdminHref(m[4])
          ? { kind: "link", text: m[3], href: m[4] }
          : { kind: "text", text: m[3] },
      );
    }
    last = at + m[0].length;
  }
  if (last < line.length) out.push({ kind: "text", text: line.slice(last) });
  return out;
}

const BULLET = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/;

export function parseChatMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  // `as` rather than an annotation: an annotated `= null` narrows to null for
  // the whole loop, since TS does not see the closures below reassigning it.
  let list = null as { ordered: boolean; items: Inline[][] } | null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "para", parts: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ...list });
    list = null;
  };

  for (const raw of src.replace(/\r\n/g, "\n").split("\n")) {
    // Headings render as bold paragraphs; the panel is too small for sizes.
    const line = raw.replace(/^#{1,6}\s+(.*)$/, "**$1**");
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const b = line.match(BULLET);
    if (b) {
      flushPara();
      const ordered = b[1] !== undefined;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(parseInline(b[2]));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}
