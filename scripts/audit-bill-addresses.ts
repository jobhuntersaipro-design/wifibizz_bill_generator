/**
 * Audit a bill's address formatting against case addresses.
 *
 *   npx tsx scripts/audit-bill-addresses.ts <cases.json> <out.csv>
 *   npx tsx scripts/audit-bill-addresses.ts --bill time <cases.json> <out.csv>
 *   npx tsx scripts/audit-bill-addresses.ts --bill umobile <cases.json> <out.csv>
 *
 * <cases.json> is an array of case rows as `/api/cases` returns them (case_no, provider,
 * full_address). Default `--bill umobile` runs each address through `normalizeAddress(…,
 * 'internet')`. `--bill time` runs it through the TIME invoice's `buildInvoiceAddress`
 * (Helvetica 9pt, the same 300pt box the page draws into).
 *
 * TIME rows are those whose provider matches /\btime\b/i. A row with no provider is
 * included, so a file that was already filtered to TIME still audits. Umobile mode
 * audits every row, as before.
 *
 * PASS for TIME means the printed lines contain no introduced `...`, no dropped source
 * token, and no pair of tokens run together (see `auditTimeBillAddress`).
 *
 * Runs locally with no Google key: geocoding only fills a MISSING postcode / city / state,
 * never a street token, so the street half of the audit is exactly what production prints.
 * The input and output hold customer addresses — keep them out of the repo.
 * A synthetic stand-in lives at scripts/fixtures/time-address-cases.json.
 */
import { readFileSync, writeFileSync } from 'fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { normalizeAddress } from '../src/lib/bill-generator/address-normalizer';
import { auditBillAddress, auditTimeBillAddress } from '../src/lib/bill-generator/address-audit';
import {
  buildInvoiceAddress,
  printedTimeAddress,
  TIME_ADDRESS_FONT_SIZE,
  TIME_ADDRESS_MAX_WIDTH,
  type Measure,
} from '../src/lib/bill-generator/time-invoice-fields';

interface CaseRow {
  case_no: string;
  provider?: string | null;
  full_address?: string | null;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function parseArgs(argv: string[]): { bill: 'umobile' | 'time'; input?: string; output?: string } {
  let bill: 'umobile' | 'time' = 'umobile';
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--bill') {
      const value = argv[++i];
      if (value !== 'umobile' && value !== 'time') {
        console.error('usage: tsx scripts/audit-bill-addresses.ts [--bill umobile|time] <cases.json> <out.csv>');
        process.exit(2);
      }
      bill = value;
    } else {
      positional.push(argv[i]);
    }
  }
  return { bill, input: positional[0], output: positional[1] };
}

function includeRow(row: CaseRow, bill: 'umobile' | 'time'): boolean {
  if (!row.full_address?.trim()) return false;
  if (bill === 'time' && row.provider && !/\btime\b/i.test(row.provider)) return false;
  return true;
}

async function timeMeasure(): Promise<Measure> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  return (text) => font.widthOfTextAtSize(text, TIME_ADDRESS_FONT_SIZE);
}

async function main() {
  const { bill, input, output } = parseArgs(process.argv.slice(2));
  if (!input || !output) {
    console.error('usage: tsx scripts/audit-bill-addresses.ts [--bill umobile|time] <cases.json> <out.csv>');
    process.exit(2);
  }
  delete process.env.GOOGLE_MAPS_API_KEY;

  const rows = (JSON.parse(readFileSync(input, 'utf8')) as CaseRow[]).filter((r) => includeRow(r, bill));
  const measure = bill === 'time' ? await timeMeasure() : null;
  const lines =
    bill === 'time'
      ? ['case_no,source_address,bill_address,result']
      : ['case_no,provider,source_address,bill_address,result,missing_tokens'];
  let failed = 0;

  for (const row of rows) {
    if (bill === 'time') {
      const packed = await buildInvoiceAddress(row.full_address!, '', measure!, TIME_ADDRESS_MAX_WIDTH);
      const printed = printedTimeAddress(packed);
      const audit = auditTimeBillAddress(row.full_address!, printed);
      if (!audit.pass) {
        failed++;
        const detail = [
          audit.ellipsis ? 'ellipsis' : '',
          audit.missing.length ? `missing=${audit.missing.join(' ')}` : '',
          audit.runTogether.length ? `run-together=${audit.runTogether.join(' ')}` : '',
        ]
          .filter(Boolean)
          .join('; ');
        console.error(`FAIL ${row.case_no}: ${detail}`);
      }
      lines.push(
        [row.case_no, row.full_address!, printed.join(' / '), audit.pass ? 'PASS' : 'FAIL'].map(csvCell).join(','),
      );
    } else {
      const printed = (await normalizeAddress(row.full_address!, 'internet')) as string[];
      const { pass, missing } = auditBillAddress(row.full_address!, printed);
      if (!pass) failed++;
      lines.push(
        [row.case_no, row.provider || '', row.full_address!, printed.join(' / '), pass ? 'PASS' : 'FAIL', missing.join(' ')]
          .map(csvCell)
          .join(','),
      );
    }
  }

  writeFileSync(output, lines.join('\n') + '\n');
  console.log(`${rows.length} cases, ${rows.length - failed} PASS, ${failed} FAIL → ${output}`);
  if (failed) process.exit(1);
}

main();
