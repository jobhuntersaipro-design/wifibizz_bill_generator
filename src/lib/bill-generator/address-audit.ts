/**
 * Token audit for a bill's printed address against the case's source address.
 *
 * A bill may re-order, wrap and abbreviate the address, but it must not DROP anything the
 * customer would check it against — a unit number, a lot, a block, a street word. So every
 * distinct token of the source address has to appear somewhere in the printed lines, after
 * the normalisations the formatter applies on purpose (listed in INTENTIONAL_NORMALISATIONS).
 *
 * Distinct tokens, not a multiset: the portal repeats the town and state ("PUTRAJAYA …
 * PUTRAJAYA"), and printing it once is not a loss.
 */

import { normalizePortalPunctuation } from './address-normalizer';

/** What the formatter changes on purpose. Anything else missing from the bill is a loss. */
export const INTENTIONAL_NORMALISATIONS = [
  'FTTH is dropped (a portal marker, not part of the address)',
  'MALAYSIA is dropped from the source and printed once at the end of the locality line',
  'WILAYAH PERSEKUTUAN / FEDERAL TERRITORY OF / W.P. before a federal territory is printed as WP',
  "A bare '-' (the portal's segment separator) is dropped",
  'Commas are dropped, whitespace collapsed, and a trailing full stop dropped',
  "A state's honorific is dropped after the state (SELANGOR DARUL EHSAN → SELANGOR)",
  'A colon-delimited reference pasted onto the address (N:20260101:…:EAI…) is dropped',
  'Full-width and CJK punctuation (，、．：；（） and the ideographic space) folds to ASCII; other full-width ASCII folds via NFKC when that fold is itself ASCII',
] as const;

const FT = '(?:KUALA LUMPUR|PUTRAJAYA|LABUAN)';
const STATE_NAMES = 'JOHOR|KEDAH|KELANTAN|NEGERI SEMBILAN|PAHANG|PERAK|SELANGOR|TERENGGANU';

/**
 * Tokens used for comparison. A leading or trailing mark (`*1087`, `#1087`, `1087*`)
 * is not part of the token, so `*1087` and `1087` compare equal. Internal punctuation
 * stays (`3/1A`, `B-12-03A`, `U.01`). This does not change what the bill prints.
 */
function tokens(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, ''))
    .filter(Boolean);
}

function sourceTokens(source: string): string[] {
  const text = normalizePortalPunctuation(source)
    .toUpperCase()
    .replace(/,/g, ' ')
    .replace(/\bMALAYSIA\b/g, ' ')
    .replace(/(^|\s)\S*:\S*:\S*(?=\s|$)/g, ' ')
    .replace(new RegExp(`\\b(${STATE_NAMES})\\s+DARUL\\s+[A-Z']+`, 'g'), '$1')
    .replace(/\bWILAYAH\s+PERSEKUTUAN\b/g, 'WP')
    .replace(/\bFEDERAL\s+TERRITORY\s+OF\b/g, 'WP')
    .replace(new RegExp(`(^|\\s)W\\.?\\s?P\\.?(?=\\s+${FT}\\b|\\s*$)`, 'g'), ' WP');
  return tokens(text).filter((t) => t !== 'FTTH' && t !== 'MALAYSIA' && t !== '-' && t !== 'WP');
}

const compact = (text: string) => text.toUpperCase().replace(/[\s,.]+/g, '');

export interface AddressAudit {
  pass: boolean;
  /** Source tokens that appear nowhere on the printed address. */
  missing: string[];
}

/**
 * A token is present if the bill prints it as a token. A token with punctuation glued inside
 * it ("SIK.KEDAH", "RAMLEE/JALAN") may be printed split at that punctuation, so for those —
 * and only those — the bill's text with whitespace removed is searched instead. A plain
 * token never gets that leniency: "01" must be printed as "01", not found inside "U.01".
 */
export function auditBillAddress(source: string, billLines: string[]): AddressAudit {
  const printed = new Set(tokens(billLines.join(' ')));
  const printedCompact = compact(billLines.join(' '));
  const missing = [...new Set(sourceTokens(source))].filter(
    (t) => !printed.has(t) && !(/[^A-Z0-9]/.test(t) && printedCompact.includes(compact(t))),
  );
  return { pass: missing.length === 0, missing };
}

export interface TimeAddressAudit extends AddressAudit {
  /** Adjacent source tokens printed with nothing between them (`03ATHE`). */
  runTogether: string[];
  /** The bill grew an ellipsis the source did not already contain. */
  ellipsis: boolean;
}

function ellipsisCount(text: string): number {
  return (text.match(/\.\.\./g) ?? []).length + (text.match(/\u2026/g) ?? []).length;
}

/**
 * Two neighbouring source tokens jammed into one (`B-12-03A` + `THE` → `B-12-03ATHE`).
 * A missing-token check catches most of these; this names the join so the audit CSV
 * can say why a row failed.
 *
 * The jammed string has to be printed AND at least one of the two tokens has to be
 * absent as its own token. Otherwise a real word that happens to be the concatenation
 * (`HILL` + `PARK` inside an address that also contains `HILLPARK`) is a false fail.
 */
function runTogetherTokens(source: string, bill: string): string[] {
  const toks = sourceTokens(source);
  const printed = new Set(tokens(bill));
  const upper = bill.toUpperCase();
  const hits: string[] = [];
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i];
    const b = toks[i + 1];
    if (a.length < 2 || b.length < 2) continue;
    if (printed.has(a) && printed.has(b)) continue;
    const jammed = a + b;
    if (upper.includes(jammed)) hits.push(jammed);
  }
  return [...new Set(hits)];
}

/** CSV fields for a TIME audit row. A fail always has a non-empty reason. */
export function timeAuditDetail(audit: TimeAddressAudit): { missingTokens: string; reason: string } {
  const parts = [
    audit.ellipsis ? 'ellipsis' : '',
    audit.missing.length ? `missing=${audit.missing.join(' ')}` : '',
    audit.runTogether.length ? `run-together=${audit.runTogether.join(' ')}` : '',
  ].filter(Boolean);
  return { missingTokens: audit.missing.join(' '), reason: parts.join('; ') };
}

/**
 * TIME bill address audit. PASS means the printed lines have no introduced `...`,
 * no source token missing, and no pair of tokens run together.
 */
export function auditTimeBillAddress(source: string, billLines: string[]): TimeAddressAudit {
  const bill = billLines.join(' ');
  const ellipsis = ellipsisCount(bill) > ellipsisCount(normalizePortalPunctuation(source));
  const { missing } = auditBillAddress(source, billLines);
  const runTogether = runTogetherTokens(source, bill);
  return {
    pass: !ellipsis && missing.length === 0 && runTogether.length === 0,
    missing,
    runTogether,
    ellipsis,
  };
}
