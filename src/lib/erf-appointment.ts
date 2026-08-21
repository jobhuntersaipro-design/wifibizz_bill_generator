import { inflateSync } from "node:zlib";

/**
 * Reading the installation appointment out of an order's e-RF.
 *
 * The e-RF (electronic Registration Form) is the PDF the Unifi portal issues on
 * the confirmation page after Pay, stored in R2 by the submit run. It is the
 * only record BizzFlow has of the slot that was actually booked: the scraper
 * picks the slot (`_set_appointment` returns it) and then keeps nothing but the
 * step's status, so for every order placed so far the document is the sole
 * source.
 *
 * The document prints one line:
 *
 *     Installation Appointment Date   : 2026-08-20 09:30-12:00
 *
 * and the value is kept VERBATIM. It is a date plus a two-ended arrival window,
 * not an instant, and reshaping it into a Date would invent a precision the
 * appointment does not have — the installer turns up somewhere inside those two
 * and a half hours.
 *
 * No PDF library. These are text PDFs with FlateDecode content streams, and the
 * value sits in a plain string literal a `Tj` away from its label, so inflating
 * and reading the literals is the whole job. Adding a PDF text-extraction
 * dependency to reach one line of a fixed template buys nothing.
 */

/** `2026-08-20 09:30-12:00`, or a bare `2026-08-20` when no window is printed. */
const APPOINTMENT_VALUE = /^\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})?$/;

const LABEL = /installation\s+appointment\s+date/i;

/**
 * Every `(...)Tj` string literal in a PDF content stream, in drawing order.
 *
 * The portal writes each field's label and value as its own literal, so the
 * value is simply the next literal after the label — position on the page never
 * has to be reasoned about.
 *
 * PDF escapes (`\(`, `\)`, `\\`) are honoured so a literal containing a bracket
 * cannot end the scan early. Octal escapes are left alone: the fields this reads
 * are ASCII, and half-decoding would be worse than not decoding.
 */
export function pdfTextLiterals(content: string): string[] {
  const out: string[] = [];
  const re = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push(m[1].replace(/\\([()\\])/g, "$1"));
  }
  return out;
}

/**
 * The appointment value from an already-extracted stream (or from plain text).
 *
 * Two passes, in this order:
 *
 * 1. Label literal, then the next literal that has the SHAPE of a date. The
 *    shape check is what stops a portal that reorders or inserts a field from
 *    silently reporting the neighbouring label as an appointment.
 * 2. A `label : value` regex, for a PDF that lays the line out as one run of
 *    text rather than two literals — and for the `pdftotext` form, which is what
 *    a human checking this by hand will be looking at.
 *
 * Returns null when the document simply has no appointment line. That is a real
 * and correct answer: a self-install e-RF prints none.
 */
export function readAppointmentFromContent(content: string): string | null {
  const literals = pdfTextLiterals(content);
  const at = literals.findIndex((s) => LABEL.test(s));
  if (at >= 0) {
    for (const next of literals.slice(at + 1, at + 4)) {
      const v = next.trim();
      if (APPOINTMENT_VALUE.test(v)) return normalizeAppointment(v);
    }
  }

  const m = content.match(
    /installation\s+appointment\s+date[^\S\r\n]*[:：][^\S\r\n]*(\d{4}-\d{2}-\d{2}(?:[^\S\r\n]+\d{1,2}:\d{2}[^\S\r\n]*-[^\S\r\n]*\d{1,2}:\d{2})?)/i,
  );
  return m ? normalizeAppointment(m[1]) : null;
}

/** Collapse the whitespace the layout put in; the value's own spacing is one space. */
function normalizeAppointment(v: string): string {
  return v.trim().replace(/\s+/g, " ").replace(/\s*-\s*/g, "-");
}

/**
 * Inflate every FlateDecode stream in the file and concatenate what comes back.
 *
 * Streams that are not deflate (or are images, or fonts) throw or yield binary;
 * both are skipped rather than reported, because a font failing to inflate says
 * nothing about whether the text we want is present. `latin1` throughout, so a
 * byte is never lost to UTF-8 replacement before the regexes see it.
 */
export function pdfContentText(pdf: Uint8Array): string {
  const buf = Buffer.from(pdf);
  const raw = buf.toString("latin1");
  const parts: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    try {
      const text = inflateSync(buf.subarray(start, end)).toString("latin1");
      if (text.includes("Tj") || LABEL.test(text)) parts.push(text);
    } catch {
      // Not a deflate stream (or not one we can read) — nothing to learn here.
    }
  }
  // Some generators leave content uncompressed; the raw file is then the text.
  if (parts.length === 0) parts.push(raw);
  return parts.join("\n");
}

/** The appointment printed on an e-RF PDF, or null if it prints none. */
export function parseInstallationAppointment(pdf: Uint8Array): string | null {
  return readAppointmentFromContent(pdfContentText(pdf));
}

/**
 * The stored value split for display: `20-08-2026` over `09:30-12:00`.
 *
 * DD-MM-YYYY to match Created At, and built from the string's own parts rather
 * than through a Date — `toLocaleDateString` follows the VIEWER's locale, which
 * is how the same order came to read 17/08/2026 for one agent and 8/17/2026 for
 * another. A value that does not parse is returned as-is on the date line, so an
 * unexpected format is visible rather than silently blank.
 */
export function installationParts(
  value: string | null | undefined,
): { date: string; time: string | null } | null {
  const v = value?.trim();
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(.+))?$/);
  if (!m) return { date: v, time: null };
  return { date: `${m[3]}-${m[2]}-${m[1]}`, time: m[4]?.trim() || null };
}
