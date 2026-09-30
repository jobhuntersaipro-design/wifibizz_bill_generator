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

/** What the formatter changes on purpose. Anything else missing from the bill is a loss. */
export const INTENTIONAL_NORMALISATIONS = [
  'FTTH is dropped (a portal marker, not part of the address)',
  'MALAYSIA is dropped from the source and printed once at the end of the locality line',
  'WILAYAH PERSEKUTUAN / FEDERAL TERRITORY OF / W.P. before a federal territory is printed as WP',
  "A bare '-' (the portal's segment separator) is dropped",
  'Commas are dropped, whitespace collapsed, and a trailing full stop dropped',
  "A state's honorific is dropped after the state (SELANGOR DARUL EHSAN → SELANGOR)",
  'A colon-delimited reference pasted onto the address (N:20260101:…:EAI…) is dropped',
] as const;

const FT = '(?:KUALA LUMPUR|PUTRAJAYA|LABUAN)';
const STATE_NAMES = 'JOHOR|KEDAH|KELANTAN|NEGERI SEMBILAN|PAHANG|PERAK|SELANGOR|TERENGGANU';

function tokens(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/\.+$/, ''))
    .filter(Boolean);
}

function sourceTokens(source: string): string[] {
  const text = source
    .toUpperCase()
    .replace(/^\*+/, '')
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
