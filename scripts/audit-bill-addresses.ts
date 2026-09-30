/**
 * Audit the Umobile bill's address formatting against real case addresses.
 *
 *   npx tsx scripts/audit-bill-addresses.ts <cases.json> <out.csv>
 *
 * <cases.json> is an array of case rows as `/api/cases` returns them (case_no, provider,
 * full_address). Each address is run through the same `normalizeAddress(…, 'internet')` the
 * bill generator uses, and every source token is checked against the printed lines
 * (see `auditBillAddress`). Writes one CSV row per case and exits non-zero on any FAIL.
 *
 * Runs locally with no Google key: geocoding only fills a MISSING postcode / city / state,
 * never a street token, so the street half of the audit is exactly what production prints.
 * The input and output hold customer addresses — keep them out of the repo.
 */
import { readFileSync, writeFileSync } from 'fs';
import { normalizeAddress } from '../src/lib/bill-generator/address-normalizer';
import { auditBillAddress } from '../src/lib/bill-generator/address-audit';

interface CaseRow {
  case_no: string;
  provider?: string | null;
  full_address?: string | null;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: tsx scripts/audit-bill-addresses.ts <cases.json> <out.csv>');
    process.exit(2);
  }
  delete process.env.GOOGLE_MAPS_API_KEY;

  const rows = (JSON.parse(readFileSync(input, 'utf8')) as CaseRow[]).filter((r) => r.full_address?.trim());
  const lines = ['case_no,provider,source_address,bill_address,result,missing_tokens'];
  let failed = 0;

  for (const row of rows) {
    const bill = (await normalizeAddress(row.full_address!, 'internet')) as string[];
    const { pass, missing } = auditBillAddress(row.full_address!, bill);
    if (!pass) failed++;
    lines.push(
      [row.case_no, row.provider || '', row.full_address!, bill.join(' / '), pass ? 'PASS' : 'FAIL', missing.join(' ')]
        .map(csvCell)
        .join(','),
    );
  }

  writeFileSync(output, lines.join('\n') + '\n');
  console.log(`${rows.length} cases, ${rows.length - failed} PASS, ${failed} FAIL → ${output}`);
  if (failed) process.exit(1);
}

main();
