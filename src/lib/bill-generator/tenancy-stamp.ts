/**
 * Stamp a tenant name + NRIC onto Chris's tenancy-agreement template.
 *
 * The sample is an iOS Quartz text PDF (Form: none), not an AcroForm. Literals
 * are custom-encoded subset fonts; ToUnicode maps turn them back into
 * "NUR SYAFIQAH…". A 0.24 cm also means Tm e,f are not page coordinates — we
 * multiply by the CTM before drawing.
 */

import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFDict,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { inflateSync } from 'zlib';
import { getPageStreamRefs, transformStream } from './pdf-utils';
import { wrapToWidth } from './authorization-letter';
import {
  SAMPLE_TENANT_NAME,
  SAMPLE_TENANT_NAME_LINE1,
  SAMPLE_TENANT_NAME_LINE2,
  SAMPLE_TENANT_NRIC,
  SAMPLE_COVER_DAY,
  SAMPLE_COVER_MONTH,
  SAMPLE_COVER_YEAR,
  SAMPLE_SCHEDULE_DATE,
  coverDayLabel,
  coverMonthLabel,
  scheduleDateLabel,
  agreementDateFrom,
  type TenantStamp,
} from './tenancy-fields';

const INK = rgb(0, 0, 0);

export interface TextRun {
  text: string;
  x: number;
  y: number;
  size: number;
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

function inflateMaybe(stream: PDFRawStream): Buffer {
  const contents = Buffer.from(stream.getContents());
  const filter = stream.dict.get(PDFName.of('Filter'));
  const filterStr = filter ? filter.toString() : '';
  if (filterStr.includes('FlateDecode')) {
    try {
      return inflateSync(contents);
    } catch {
      return contents;
    }
  }
  return contents;
}

export function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const hexToStr = (h: string) => {
    const buf = Buffer.from(h.replace(/\s+/g, ''), 'hex');
    if (buf.length === 1) return String.fromCharCode(buf[0]);
    let s = '';
    for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
    return s || buf.toString('latin1');
  };
  for (const chunk of cmap.split(/beginbfchar/).slice(1)) {
    const body = chunk.split(/endbfchar/)[0];
    for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(m[1], 16), hexToStr(m[2]));
    }
  }
  for (const chunk of cmap.split(/beginbfrange/).slice(1)) {
    const body = chunk.split(/endbfrange/)[0];
    for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const start = parseInt(m[1], 16);
      const end = parseInt(m[2], 16);
      let dest = parseInt(m[3], 16);
      for (let c = start; c <= end; c++) map.set(c, String.fromCharCode(dest++));
    }
    for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]+)\]/g)) {
      const start = parseInt(m[1], 16);
      [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((x, idx) => {
        map.set(start + idx, hexToStr(x[1]));
      });
    }
  }
  return map;
}

export function loadPageCmaps(pdfDoc: PDFDocument, page: PDFPage): Map<string, Map<number, string>> {
  const cmaps = new Map<string, Map<number, string>>();
  const fonts = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
  if (!fonts) return cmaps;
  for (const key of fonts.keys()) {
    const font = fonts.lookup(key, PDFDict);
    const tu = font.get(PDFName.of('ToUnicode'));
    const tuObj = tu instanceof PDFRef ? pdfDoc.context.lookup(tu) : tu;
    if (tuObj instanceof PDFRawStream) {
      cmaps.set(key.toString().replace(/^\//, ''), parseToUnicode(inflateMaybe(tuObj).toString('latin1')));
    }
  }
  return cmaps;
}

function decodeLiteralWithCmap(raw: string, cmap?: Map<number, string>): string {
  if (!cmap || cmap.size === 0) return decodePdfLiteral(raw);
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const n = raw[i + 1];
      if (n === '(' || n === ')' || n === '\\') {
        out += cmap.get(n.charCodeAt(0)) ?? n;
        i += 1;
        continue;
      }
      if (/[0-7]/.test(n)) {
        let oct = n;
        let j = i + 2;
        while (oct.length < 3 && j < raw.length && /[0-7]/.test(raw[j])) oct += raw[j++];
        const code = parseInt(oct, 8);
        out += cmap.get(code) ?? String.fromCharCode(code);
        i = j - 1;
        continue;
      }
      i += 1;
      continue;
    }
    out += cmap.get(raw.charCodeAt(i)) ?? raw[i];
  }
  return out;
}

function decodeHexWithCmap(hex: string, cmap?: Map<number, string>): string {
  if (!cmap || cmap.size === 0) return decodePdfHex(hex);
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) return '';
  const buf = Buffer.from(clean, 'hex');
  let out = '';
  for (const b of buf) out += cmap.get(b) ?? String.fromCharCode(b);
  return out;
}

type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];

function mul(m: M, n: M): M {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: M, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Walk a decompressed content stream. Honours q/Q/cm so Quartz's 0.24 scale
 * yields page-space x/y. Optional ToUnicode maps decode subset fonts.
 */
export function extractTextRuns(
  content: string,
  cmaps?: Map<string, Map<number, string>>,
): TextRun[] {
  const runs: TextRun[] = [];
  let ctm: M = IDENTITY;
  const stack: M[] = [];
  let tm: M = IDENTITY;
  let font = '';
  let tf = 1;
  let i = 0;

  const next = (re: RegExp): RegExpExecArray | null => {
    const m = new RegExp('^' + re.source).exec(content.slice(i));
    return m;
  };

  while (i < content.length) {
    const cm = next(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+cm/);
    if (cm) {
      ctm = mul(ctm, [+cm[1], +cm[2], +cm[3], +cm[4], +cm[5], +cm[6]]);
      i += cm[0].length;
      continue;
    }
    const tmm = next(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/);
    if (tmm) {
      tm = [+tmm[1], +tmm[2], +tmm[3], +tmm[4], +tmm[5], +tmm[6]];
      i += tmm[0].length;
      continue;
    }
    const td = next(/(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]/);
    if (td) {
      tm = mul(tm, [1, 0, 0, 1, +td[1], +td[2]]);
      i += td[0].length;
      continue;
    }
    const tfm = next(/\/([^\s[/<>()]+)\s+([\d.]+)\s+Tf/);
    if (tfm) {
      font = tfm[1];
      tf = Number(tfm[2]) || tf;
      i += tfm[0].length;
      continue;
    }
    if (content.startsWith('T*', i)) {
      tm = mul(tm, [1, 0, 0, 1, 0, -(tf || 1)]);
      i += 2;
      continue;
    }
    if ((content[i] === 'q' || content[i] === 'Q') && /\s/.test(content[i + 1] ?? ' ')) {
      if (content[i] === 'q') stack.push(ctm);
      else ctm = stack.pop() ?? IDENTITY;
      i += 1;
      continue;
    }

    const cmap = cmaps?.get(font);
    const lit = next(/\(((?:\\.|[^\\()])*)\)\s*(Tj|')/);
    if (lit) {
      if (lit[2] === "'") tm = mul(tm, [1, 0, 0, 1, 0, -(tf || 1)]);
      const [x, y] = apply(mul(ctm, tm), 0, 0);
      const size = Math.abs(tm[0] * ctm[0] * tf) || 12;
      runs.push({
        text: decodeLiteralWithCmap(lit[1], cmap),
        x,
        y,
        size,
        start: i,
        end: i + lit[0].length,
      });
      i += lit[0].length;
      continue;
    }
    const hex = next(/<([0-9A-Fa-f\s]+)>\s*(Tj|')/);
    if (hex) {
      if (hex[2] === "'") tm = mul(tm, [1, 0, 0, 1, 0, -(tf || 1)]);
      const [x, y] = apply(mul(ctm, tm), 0, 0);
      const size = Math.abs(tm[0] * ctm[0] * tf) || 12;
      runs.push({
        text: decodeHexWithCmap(hex[1], cmap),
        x,
        y,
        size,
        start: i,
        end: i + hex[0].length,
      });
      i += hex[0].length;
      continue;
    }
    const arr = next(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\s*TJ/);
    if (arr) {
      const text = Array.from(arr[1].matchAll(/\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>/g))
        .map((m) => (m[1] !== undefined ? decodeLiteralWithCmap(m[1], cmap) : decodeHexWithCmap(m[2], cmap)))
        .join('');
      const [x, y] = apply(mul(ctm, tm), 0, 0);
      const size = Math.abs(tm[0] * ctm[0] * tf) || 12;
      runs.push({ text, x, y, size, start: i, end: i + arr[0].length });
      i += arr[0].length;
      continue;
    }
    i += 1;
  }
  return runs;
}

export type StampKind = 'name' | 'nric' | 'cover-day' | 'cover-month' | 'cover-year' | 'schedule-date';

export interface StampHit {
  needle: string;
  kind?: StampKind;
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
  const compact = findCompactHits(runs, needle);
  if (compact.length) return compact;
  const hits: StampHit[] = [];
  const joined = runs.map((r) => r.text);
  collectHits(runs, needle, joined.join(''), 0, hits);
  if (!hits.length) collectHits(runs, needle, joined.join(' '), 1, hits);
  return hits;
}

/** Quartz splits "NUR SYAFIQAH" across many Tj runs, sometimes without spaces. */
function findCompactHits(runs: TextRun[], needle: string): StampHit[] {
  const compactNeedle = needle.replace(/\s+/g, '');
  if (!compactNeedle) return [];
  const map: { runIndex: number; local: number }[] = [];
  let hay = '';
  for (let i = 0; i < runs.length; i++) {
    const t = runs[i].text;
    for (let j = 0; j < t.length; j++) {
      if (/\s/.test(t[j])) continue;
      map.push({ runIndex: i, local: j });
      hay += t[j];
    }
  }
  const hits: StampHit[] = [];
  let from = 0;
  while (from <= hay.length) {
    const at = hay.indexOf(compactNeedle, from);
    if (at < 0) break;
    const used = new Set<number>();
    for (let k = at; k < at + compactNeedle.length; k++) used.add(map[k].runIndex);
    const first = runs[map[at].runIndex];
    const before = first.text.slice(0, map[at].local);
    const named = NAME_PREFIX.exec(before) || NRIC_PREFIX.exec(before);
    const lineYs = [...new Set([...used].map((idx) => runs[idx].y))].sort((a, b) => b - a);
    hits.push({
      needle,
      x: first.x,
      y: first.y,
      size: first.size || 12,
      prefix: named ? named[1] : before,
      firstLineWidth: 0,
      lineYs,
      ranges: [...used]
        .sort((a, b) => a - b)
        .map((idx) => ({ start: runs[idx].start, end: runs[idx].end })),
    });
    from = at + compactNeedle.length;
  }
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

interface FieldNeedle {
  needle: string;
  kind: StampKind;
  yMin?: number;
  yMax?: number;
  /** When the same token also appears as commence, keep the higher (Section 1) hit. */
  topmost?: boolean;
}

function dateNeedlesForPage(pageIndex: number): FieldNeedle[] {
  if (pageIndex === 0) {
    return [
      { needle: SAMPLE_COVER_DAY, kind: 'cover-day', yMin: 700, yMax: 730 },
      { needle: SAMPLE_COVER_MONTH, kind: 'cover-month', yMin: 700, yMax: 730 },
      { needle: SAMPLE_COVER_YEAR, kind: 'cover-year', yMin: 700, yMax: 730 },
    ];
  }
  return [{ needle: SAMPLE_SCHEDULE_DATE, kind: 'schedule-date', topmost: true }];
}

function isNricNeedle(needle: string): boolean {
  return needle.replace(/\D/g, '') === SAMPLE_TENANT_NRIC.replace(/\D/g, '');
}

export function blankSampleTenant(
  pdfDoc: PDFDocument,
  page: PDFPage,
  pageIndex = 0,
): StampHit[] {
  const hits: StampHit[] = [];
  const tenantNeedles: FieldNeedle[] = needlesForTemplate().map((needle) => ({
    needle,
    kind: isNricNeedle(needle) ? 'nric' : 'name',
  }));
  const specs: FieldNeedle[] = [...tenantNeedles, ...dateNeedlesForPage(pageIndex)];
  const cmaps = loadPageCmaps(pdfDoc, page);

  for (const entry of getPageStreamRefs(pdfDoc, page)) {
    transformStream(pdfDoc, entry, (buf) => {
      const content = buf.toString('latin1');
      const runs = extractTextRuns(content, cmaps);
      const pageHits: StampHit[] = [];
      const seen = new Set<string>();
      for (const spec of specs) {
        let found = findNeedleHits(runs, spec.needle).map((h) => ({ ...h, needle: spec.needle, kind: spec.kind }));
        if (spec.yMin != null) {
          found = found.filter((h) => h.y >= spec.yMin! && h.y <= (spec.yMax ?? 1e9));
        }
        if (spec.topmost && found.length > 1) {
          const maxY = Math.max(...found.map((h) => h.y));
          found = found.filter((h) => h.y >= maxY - 2);
        }
        for (const hit of found) {
          const key = `${hit.x}:${hit.y}:${spec.needle}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pageHits.push(hit);
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

/** Cover + First Schedule are Times Bold; the execution page is Arial Bold. */
function pickFont(fonts: { serif: PDFFont; sans: PDFFont }, pageIndex: number): PDFFont {
  return pageIndex === 8 ? fonts.sans : fonts.serif;
}

function shouldRedraw(hit: StampHit, pageHits: StampHit[]): boolean {
  if (hit.kind && hit.kind !== 'name' && hit.kind !== 'nric') return true;
  const hasFullName = pageHits.some((h) => h.needle === SAMPLE_TENANT_NAME);
  const hasLine1 = pageHits.some((h) => h.needle === SAMPLE_TENANT_NAME_LINE1);
  if (hasFullName && (hit.needle === SAMPLE_TENANT_NAME_LINE1 || hit.needle === SAMPLE_TENANT_NAME_LINE2)) {
    return false;
  }
  if (!hasFullName && hasLine1 && hit.needle === SAMPLE_TENANT_NAME_LINE2) {
    return false;
  }
  return true;
}

function drawCoverDay(page: PDFPage, font: PDFFont, hit: StampHit, stamp: TenantStamp): void {
  const size = hit.size >= 6 && hit.size <= 36 ? hit.size : 10;
  const day = String(stamp.date.day);
  const suffix = coverDayLabel(stamp.date).slice(day.length);
  page.drawText(day, { x: hit.x, y: hit.y, size, font, color: INK });
  const suffixSize = Math.max(6, size * 0.78);
  page.drawText(suffix, {
    x: hit.x + font.widthOfTextAtSize(day, size),
    y: hit.y + size * 0.5,
    size: suffixSize,
    font,
    color: INK,
  });
}

function drawReplacement(
  page: PDFPage,
  font: PDFFont,
  hit: StampHit,
  stamp: TenantStamp,
  pageIndex: number,
): void {
  const size = hit.size >= 6 && hit.size <= 36 ? hit.size : 11;

  if (hit.kind === 'cover-day') {
    drawCoverDay(page, font, hit, stamp);
    return;
  }
  if (hit.kind === 'cover-month') {
    page.drawText(coverMonthLabel(stamp.date), { x: hit.x, y: hit.y, size, font, color: INK });
    return;
  }
  if (hit.kind === 'cover-year') {
    page.drawText(String(stamp.date.year), { x: hit.x, y: hit.y, size, font, color: INK });
    return;
  }
  if (hit.kind === 'schedule-date') {
    page.drawText(scheduleDateLabel(stamp.date), { x: hit.x, y: hit.y, size, font, color: INK });
    return;
  }

  const replacement = isNricNeedle(hit.needle) ? stamp.nric : stamp.name;
  const label = hit.prefix;
  const pageW = page.getWidth();

  if (isNricNeedle(hit.needle)) {
    page.drawText(`${label}${replacement}`, { x: hit.x, y: hit.y, size, font, color: INK });
    return;
  }

  const maxLines = pageIndex === 0 ? Math.max(hit.lineYs.length, 2) : 3;
  let nameBudget =
    hit.lineYs.length > 1
      ? Math.max(font.widthOfTextAtSize(SAMPLE_TENANT_NAME_LINE1, size), pageIndex === 0 ? 240 : 80)
      : Math.max(font.widthOfTextAtSize(SAMPLE_TENANT_NAME, size) * 0.55, pageW - hit.x - 36);
  nameBudget = Math.min(Math.max(nameBudget, 80), pageW - 48);
  const prefixW = label ? font.widthOfTextAtSize(label, size) : 0;
  let lines = wrapToWidth(replacement, font, size, Math.max(nameBudget - prefixW, 80));
  while (lines.length > maxLines && nameBudget < pageW - 72) {
    nameBudget += 24;
    lines = wrapToWidth(replacement, font, size, Math.max(nameBudget - prefixW, 80));
  }
  if (lines.length > maxLines) {
    lines = [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(' ')];
  }
  const gap = hit.lineYs.length > 1 ? hit.lineYs[0] - hit.lineYs[1] : size * 1.15;
  const centered = pageIndex === 0 && !label;

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
  const resolved: TenantStamp = { ...stamp, date: stamp.date ?? agreementDateFrom() };
  const pdfDoc = await PDFDocument.load(templateBytes);
  const fonts = {
    serif: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
    sans: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };

  const pages = pdfDoc.getPages();
  let hits = 0;
  for (let i = 0; i < pages.length; i++) {
    const pageHits = blankSampleTenant(pdfDoc, pages[i], i);
    hits += pageHits.length;
    const font = pickFont(fonts, i);
    const drawn = new Set<string>();
    for (const hit of pageHits) {
      if (!shouldRedraw(hit, pageHits)) continue;
      const kind = hit.kind ?? (isNricNeedle(hit.needle) ? 'nric' : 'name');
      const key = `${Math.round(hit.x)}:${Math.round(hit.y)}:${kind}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      drawReplacement(pages[i], font, hit, resolved, i);
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
