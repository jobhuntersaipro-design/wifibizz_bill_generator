/**
 * Decode HTML character references so generated documents print real
 * characters, not the portal's escaped form (`YA&#039;ASAK`).
 *
 * WifiBizz / Laravel DataTables HTML-escapes list fields (PHP
 * `htmlspecialchars` uses `&#039;` for apostrophe). The crawler stores that
 * text as-is. Edit Cases renders it in the browser, which decodes; PDFs and
 * the WhatsApp chrome treat the string as literal text, so the entities leak.
 *
 * Output-time only — do not rewrite stored rows. A general decoder, not a
 * replace of `&#039;` alone: named (`&quot;`, `&amp;`, `&apos;`), decimal
 * (`&#39;`, `&#039;`) and hex (`&#x27;`) all decode.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  AMP: "&",
  lt: "<",
  LT: "<",
  gt: ">",
  GT: ">",
  quot: '"',
  QUOT: '"',
  apos: "'",
  nbsp: "\u00A0",
};

const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g;

export function decodeHtmlEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(ENTITY, (entity, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return entity;
      }
      if (codePoint === 0) return "\uFFFD";
      return String.fromCodePoint(codePoint);
    }
    return NAMED[body] ?? entity;
  });
}

/** Customer name as a generated document should print it. Empty stays empty. */
export function decodeCustomerName(value: string | null | undefined): string {
  return decodeHtmlEntities(value ?? "").trim();
}
