/**
 * Stamp a tenant name + NRIC onto Chris's tenancy-agreement template.
 *
 * The sample is a Quartz text PDF, not an AcroForm. The TIME invoice's lesson
 * applies: delete the original literals and redraw in a font we control, so a
 * longer name cannot sit on un-erased sample letters and a subsetted template
 * font cannot drop glyphs.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { getPageStreamRefs, transformStream } from './pdf-utils';
import { wrapToWidth } from './authorization-letter';
import {
  SAMPLE_TENANT_NAME,
  SAMPLE_TENANT_NAME_LINE1,
  SAMPLE_TENANT_NAME_LINE2,
  SAMPLE_TENANT_NRIC,
  type TenantStamp,
} from './tenancy-fields';

const INK = rgb(0, 0, 0);

export interface TextRun {
  text: string;
  x: number;
  y: number;
  size: number;
  /** Byte offset of the show token in the stream. */
  start: number;
  end: number;
}

export function decodePdfLiteral(raw: string): string {
  return raw.replace(/\\([()\\])/g, '$1');
}

export function decodePdfHex(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) return '';
  const buf = Buffer.from(clean, 'hex');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return utf16Be(buf.subarray(2));
  }
  let zeroPairs = 0;
  if (buf.length >= 4 && buf.length % 2 === 0) {
    for (let i = 0; i < buf.length; i += 2) if (buf[i] === 0) zeroPairs++;
    if (zeroPairs >= buf.length / 4) return utf16Be(buf);
  }
  return buf.toString('latin1');
}

function utf16Be(buf: Buffer): string {
  const swapped = Buffer.alloc(buf.length);
  for (let i = 0; i + 1 < buf.length; i += 2) {
    swapped[i] = buf[i + 1];
    swapped[i + 1] = buf[i];
  }
  return swapped.toString('utf16le');
}

/**
 * Walk a decompressed content stream and collect every text show, with the Tm
 * translation in effect. Quartz writes an explicit Tm per run; Td/T* / `'` are
 * honoured so a different producer still maps.
 */
export function extractTextRuns(content: string): TextRun[] {
  const runs: TextRun[] = [];
  let x = 0;
  let y = 0;
  let size = 12;
  let i = 0;

  while (i < content.length) {
    const tm = matchAt(content, i, /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/);
    if (tm) {
      x = Number(tm[5]);
      y = Number(tm[6]);
      i += tm[0].length;
      continue;
    }
    const td = matchAt(content, i, /(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]/);
    if (td) {
      x += Number(td[1]);
      y += Number(td[2]);
      i += td[0].length;
      continue;
    }
    const tf = matchAt(content, i, /\/[^\s[/<>()]+?\s+([\d.]+)\s+Tf/);
    if (tf) {
      size = Number(tf[1]) || size;
      i += tf[0].length;
      continue;
    }
    if (content.startsWith('T*', i)) {
      y -= size;
      i += 2;
      continue;
    }
    const lit = matchAt(content, i, /\(((?:\\.|[^\\()])*)\)\s*(Tj|')/);
    if (lit) {
      if (lit[2] === "'") y -= size;
      runs.push({ text: decodePdfLiteral(lit[1]), x, y, size, start: i, end: i + lit[0].length });
      i += lit[0].length;
      continue;
    }
    const hex = matchAt(content, i, /<([0-9A-Fa-f\s]+)>\s*(Tj|')/);
    if (hex) {
      if (hex[2] === "'") y -= size;
      runs.push({ text: decodePdfHex(hex[1]), x, y, size, start: i, end: i + hex[0].length });
      i += hex[0].length;
      continue;
    }
    const arr = matchAt(content, i, /\[((?:[^\[\]]|\[[^\]]*\])*)\]\s*TJ/);
    if (arr) {
      const text = Array.from(arr[1].matchAll(/\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>/g))
        .map((m) => (m[1] !== undefined ? decodePdfLiteral(m[1]) : decodePdfHex(m[2])))
        .join('');
      runs.push({ text, x, y, size, start: i, end: i + arr[0].length });
      i += arr[0].length;
      continue;
    }
    i += 1;
  }
  return runs;
}

function matchAt(content: string, i: number, re: RegExp): RegExpExecArray | null {
  const sliced = content.slice(i);
  const m = new RegExp('^' + re.source).exec(sliced);
  return m;
}

export interface StampHit {
  needle: string;
  x: number;
  y: number;
  size: number;
  prefix: string;
  firstLineWidth: number;
  lineYs: number[];
  ranges: { start: number; end: number }[];
}

const NAME_PREFIX = /^(NAME\s*:\s*)/i;
const NRIC_PREFIX = /^(NRIC\s*:\s*)/i;

export function findNeedleHits(runs: TextRun[], needle: string): StampHit[] {
  if (!needle) return [];
  const hits: StampHit[] = [];
  const joined = runs.map((r) => r.text);
  const compact = joined.join('');
  // Search both the raw concatenation (no separator) and a space-joined form so
  // a name split across two Tj runs still matches.
  const spaceJoined = joined.join(' ');
  collectHits(runs, needle, compact, 0, hits);
  if (!hits.length) collectHits(runs, needle, spaceJoined, 1, hits);
  return hits;
}

function collectHits(
  runs: TextRun[],
  needle: string,
  haystack: string,
  sepLen: number,
  hits: StampHit[],
): void {
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    const mapped = mapOffset(runs, at, needle.length, sepLen);
    if (mapped) hits.push(mapped);
    from = at + needle.length;
  }
}

function mapOffset(
  runs: TextRun[],
  start: number,
  needleLen: number,
  sepLen: number,
): StampHit | null {
  let cursor = 0;
  let first: TextRun | null = null;
  const ranges: { start: number; end: number }[] = [];
  const lineYs: number[] = [];
  let prefix = '';

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const extra = i > 0 ? sepLen : 0;
    const runStart = cursor + extra;
    const runEnd = runStart + run.text.length;
    if (runEnd > start && runStart < start + needleLen) {
      ranges.push({ start: run.start, end: run.end });
      if (!first) {
        first = run;
        const local = start - runStart;
        const before = local > 0 ? run.text.slice(0, local) : '';
        const named = NAME_PREFIX.exec(before) || NRIC_PREFIX.exec(before);
        prefix = named ? named[1] : before;
      }
      if (!lineYs.includes(run.y)) lineYs.push(run.y);
    }
    cursor = runEnd;
  }
  if (!first || ranges.length === 0) return null;
  return {
    needle: '',
    x: first.x,
    y: first.y,
    size: first.size || 12,
    prefix,
    firstLineWidth: 0,
    lineYs: lineYs.sort((a, b) => b - a),
    ranges,
  };
}

function uniqueRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  const seen = new Set<string>();
  const out: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const key = `${r.start}:${r.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function blankRanges(data: Buffer, ranges: { start: number; end: number }[]): Buffer {
  const unique = [...ranges].sort((a, b) => b.start - a.start);
  let out = data;
  for (const range of unique) {
    out = Buffer.concat([
      out.subarray(0, range.start),
      Buffer.from('()Tj', 'latin1'),
      out.subarray(range.end),
    ]);
  }
  return out;
}

export function needlesForTemplate(): string[] {
  return [
    SAMPLE_TENANT_NAME,
    SAMPLE_TENANT_NAME_LINE1,
    SAMPLE_TENANT_NAME_LINE2,
    SAMPLE_TENANT_NRIC,
    SAMPLE_TENANT_NRIC.replace(/-/g, ''),
  ];
}

function isNricNeedle(needle: string): boolean {
  return needle.replace(/\D/g, '') === SAMPLE_TENANT_NRIC.replace(/\D/g, '');
}

function lastTmBefore(content: string, before: number): { x: number; y: number; size: number } {
  const window = content.slice(Math.max(0, before - 500), before);
  let x = 72;
  let y = 400;
  let size = 12;
  const tmRe = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/g;
  let m: RegExpExecArray | null;
  while ((m = tmRe.exec(window))) {
    x = Number(m[5]);
    y = Number(m[6]);
  }
  const tfRe = /\/[^\s[/<>()]+?\s+([\d.]+)\s+Tf/g;
  while ((m = tfRe.exec(window))) {
    size = Number(m[1]) || size;
  }
  return { x, y, size };
}

function enclosingShowToken(content: string, needleAt: number): { start: number; end: number } | null {
  let start = -1;
  for (let i = needleAt; i >= 0 && needleAt - i < 4000; i--) {
    const ch = content[i];
    if (ch === '(' || ch === '<' || ch === '[') {
      if (ch === '(' && i > 0 && content[i - 1] === '\\') continue;
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const rest = content.slice(start);
  const m =
    /^(\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*(?:Tj|')|\[(?:[^\[\]]|\[[^\]]*\])*\]\s*TJ)/.exec(
      rest,
    );
  if (!m) return null;
  return { start, end: start + m[0].length };
}

/** Last-resort scan when the operator parser missed a producer-specific show. */
export function findRawNeedleHits(content: string, needle: string): StampHit[] {
  if (!needle || needle.length < 4) return [];
  const hits: StampHit[] = [];
  let from = 0;
  while (from < content.length) {
    const at = content.indexOf(needle, from);
    if (at < 0) break;
    const token = enclosingShowToken(content, at);
    if (token) {
      const tm = lastTmBefore(content, at);
      hits.push({
        needle,
        x: tm.x,
        y: tm.y,
        size: tm.size,
        prefix: '',
        firstLineWidth: 0,
        lineYs: [tm.y],
        ranges: [{ start: token.start, end: token.end }],
      });
    }
    from = at + needle.length;
  }
  return hits;
}

/**
 * Blank every sample tenant name / NRIC run on one page and return the hits so
 * the caller can redraw. A page with no sample text (the ID-card scan, the
 * static clauses) is left byte-identical.
 */
export function blankSampleTenant(pdfDoc: PDFDocument, page: PDFPage): StampHit[] {
  const hits: StampHit[] = [];
  const needles = needlesForTemplate();

  for (const entry of getPageStreamRefs(pdfDoc, page)) {
    transformStream(pdfDoc, entry, (buf) => {
      const content = buf.toString('latin1');
      const runs = extractTextRuns(content);
      const pageHits: StampHit[] = [];
      const seen = new Set<string>();
      for (const needle of needles) {
        let found = findNeedleHits(runs, needle);
        if (!found.length) found = findRawNeedleHits(content, needle);
        for (const hit of found) {
          const key = `${hit.x}:${hit.y}:${needle}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pageHits.push({ ...hit, needle });
        }
      }
      if (pageHits.length === 0) return { data: buf, count: 0 };
      const ranges = uniqueRanges(pageHits.flatMap((h) => h.ranges));
      hits.push(...pageHits);
      return { data: blankRanges(buf, ranges), count: ranges.length };
    });
  }
  return hits;
}

function pickFont(fonts: { serif: PDFFont; sans: PDFFont }, pageIndex: number): PDFFont {
  return pageIndex === 0 ? fonts.serif : fonts.sans;
}

function shouldRedraw(hit: StampHit, pageHits: StampHit[]): boolean {
  const hasFullName = pageHits.some((h) => h.needle === SAMPLE_TENANT_NAME);
  const hasLine1 = pageHits.some((h) => h.needle === SAMPLE_TENANT_NAME_LINE1);
  if (hasFullName && (hit.needle === SAMPLE_TENANT_NAME_LINE1 || hit.needle === SAMPLE_TENANT_NAME_LINE2)) {
    return false;
  }
  // Cover wrap: the two name lines are separate runs. Redraw once at line 1.
  if (!hasFullName && hasLine1 && hit.needle === SAMPLE_TENANT_NAME_LINE2) {
    return false;
  }
  return true;
}

function drawReplacement(
  page: PDFPage,
  font: PDFFont,
  hit: StampHit,
  stamp: TenantStamp,
): void {
  const replacement = isNricNeedle(hit.needle) ? stamp.nric : stamp.name;
  const label = hit.prefix;
  const size = hit.size >= 6 && hit.size <= 36 ? hit.size : 11;
  const pageW = page.getWidth();
  const original = hit.needle;
  const origW = font.widthOfTextAtSize(original, size);
  const centered = Math.abs(hit.x - (pageW - origW) / 2) < 18 && !label;

  if (isNricNeedle(hit.needle)) {
    page.drawText(`${label}${replacement}`, { x: hit.x, y: hit.y, size, font, color: INK });
    return;
  }

  const firstLineBudget =
    hit.lineYs.length > 1
      ? font.widthOfTextAtSize(SAMPLE_TENANT_NAME_LINE1, size)
      : Math.max(origW, pageW - hit.x - 36);
  const nameBudget = Math.min(Math.max(firstLineBudget, 80), pageW - 48);
  const prefixW = label ? font.widthOfTextAtSize(label, size) : 0;
  const lines = wrapToWidth(replacement, font, size, Math.max(nameBudget - prefixW, 80));
  const gap = hit.lineYs.length > 1 ? hit.lineYs[0] - hit.lineYs[1] : size * 1.15;

  for (let i = 0; i < lines.length; i++) {
    const text = i === 0 ? `${label}${lines[i]}` : lines[i];
    const w = font.widthOfTextAtSize(text, size);
    const x = centered ? (pageW - w) / 2 : hit.x;
    page.drawText(text, {
      x,
      y: hit.y - i * (gap || size * 1.15),
      size,
      font,
      color: INK,
    });
  }
}

export async function stampTenancyAgreement(
  templateBytes: Uint8Array,
  stamp: TenantStamp,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const fonts = {
    serif: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
    sans: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };

  const pages = pdfDoc.getPages();
  let hits = 0;
  for (let i = 0; i < pages.length; i++) {
    const pageHits = blankSampleTenant(pdfDoc, pages[i]);
    hits += pageHits.length;
    const font = pickFont(fonts, i);
    const drawn = new Set<string>();
    for (const hit of pageHits) {
      if (!shouldRedraw(hit, pageHits)) continue;
      const kind = isNricNeedle(hit.needle) ? 'nric' : 'name';
      const key = `${Math.round(hit.x)}:${Math.round(hit.y)}:${kind}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      drawReplacement(pages[i], font, hit, stamp);
    }
  }

  if (hits === 0) {
    throw new Error(
      'The tenancy template has no extractable sample tenant name/NRIC. ' +
        'Chris’s PDF must carry those strings as text (not only as the page-12 image).',
    );
  }

  return pdfDoc.save();
}
