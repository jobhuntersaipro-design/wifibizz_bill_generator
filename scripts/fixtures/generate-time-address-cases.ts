/**
 * Build the synthetic TIME address fixture. No customer data — every row is invented.
 *
 *   npx tsx scripts/fixtures/generate-time-address-cases.ts
 *
 * Writes scripts/fixtures/time-address-cases.json. The audit script reads that file
 * the same way it will read a prod `/api/cases` export.
 */
import { writeFileSync } from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { auditTimeBillAddress } from '../../src/lib/bill-generator/address-audit';
import {
  buildInvoiceAddress,
  printedTimeAddress,
  TIME_ADDRESS_FONT_SIZE,
  TIME_ADDRESS_MAX_WIDTH,
} from '../../src/lib/bill-generator/time-invoice-fields';

interface Place {
  city: string;
  state: string;
  postcode: string;
}

const PLACES: Place[] = [
  { city: 'SUBANG JAYA', state: 'Selangor', postcode: '47500' },
  { city: 'SERI KEMBANGAN', state: 'Selangor', postcode: '43300' },
  { city: 'PETALING JAYA', state: 'Selangor', postcode: '47301' },
  { city: 'SHAH ALAM', state: 'Selangor', postcode: '40150' },
  { city: 'SUNGAI BULOH', state: 'Selangor', postcode: '47000' },
  { city: 'CYBERJAYA', state: 'Selangor', postcode: '63000' },
  { city: 'KUALA LUMPUR', state: 'Kuala Lumpur', postcode: '50000' },
  { city: 'PUTRAJAYA', state: 'Putrajaya', postcode: '62200' },
  { city: 'JOHOR BAHRU', state: 'Johor', postcode: '81200' },
  { city: 'KOTA KINABALU', state: 'Sabah', postcode: '88000' },
  { city: 'BAYAN LEPAS', state: 'Pulau Pinang', postcode: '11900' },
  { city: 'KUANTAN', state: 'Pahang', postcode: '25200' },
  { city: 'MIRI', state: 'Sarawak', postcode: '98000' },
  { city: 'KAMPAR', state: 'Perak', postcode: '31900' },
  { city: 'AYER KEROH', state: 'Melaka', postcode: '75450' },
  { city: 'BATU PAHAT', state: 'Johor', postcode: '83000' },
];

const UNITS = [
  'B-12-03A',
  '2-T.12-U.01',
  'A-10-1',
  'S2D-12-6',
  '99-G',
  'G-3-8',
  'LOT 123',
  'NO. 45',
  'NO. 12-3A/B',
  'BLOK B2',
  '12-3',
  'M9-4-07',
];

const BUILDINGS = [
  'THE REGINA',
  'EDUMETRO THE DUO',
  'META CITY TOWER B',
  'WISMA AMAN',
  'PANGSAPURI MELODI',
  'CYBERSQUARE TOWER 1',
  '',
];

const STREETS = [
  'JALAN SUBANG PERMAI',
  'JALAN SS 15/4B',
  'JALAN P5 A',
  'LORONG MALAWA COURT 2',
  'PERSIARAN SUBANG PERMAI',
  'JALAN ATMOSPHERE UTAMA 2',
  'JALAN TEKNOKRAT 6',
  'JALAN BUKIT INDAH 2/5',
];

const AREAS = [
  'TAMAN SUBANG PERMAI',
  'TAMAN PUTRA PERDANA',
  'BANDAR PUTRA PERMAI',
  'KAMPUNG PADANG KERBAU',
  'DESA MELATI',
  'PRESINT 5',
];

const GOLDEN =
  'B-12-03A\uFF0CTHE REGINA, Jalan Subang Permai, TAMAN SUBANG PERMAI, SUBANG JAYA, Selangor, 47500, Malaysia';

interface CaseRow {
  case_no: string;
  provider: string;
  full_address: string;
}

function joinUnit(unit: string, building: string, mode: number): string {
  if (!building) return unit;
  // Separators the portal actually pastes between a unit and a building name.
  switch (mode % 6) {
    case 0:
      return `${unit}, ${building}`;
    case 1:
      return `${unit}\uFF0C${building}`; // ，
    case 2:
      return `${unit}\u3001${building}`; // 、
    case 3:
      return `${unit}\u3000${building}`; // ideographic space
    case 4:
      return `${unit}\uFF1A ${building}`; // ：
    default:
      return `${unit} \uFF08${building}\uFF09`; // （ ）
  }
}

function candidates(): CaseRow[] {
  const rows: CaseRow[] = [
    { case_no: 'T-SYN-001', provider: 'TIME FTTH', full_address: GOLDEN },
    {
      case_no: 'T-SYN-002',
      provider: 'TIME FTTH',
      full_address:
        '2-T.12-U.01 FTTH BLOK B2 APARTMENT 5R6 JALAN P5 A PRESINT 5 62200 PUTRAJAYA WILAYAH PERSEKUTUAN PUTRAJAYA',
    },
  ];

  let n = 3;
  for (let u = 0; u < UNITS.length; u++) {
    for (let b = 0; b < BUILDINGS.length; b++) {
      for (let s = 0; s < STREETS.length; s++) {
        for (let a = 0; a < AREAS.length; a++) {
          const place = PLACES[(u + b + s + a) % PLACES.length];
          const ftth = (u + s) % 5 === 0 ? ' FTTH' : '';
          const head = joinUnit(UNITS[u], BUILDINGS[b], u + b + s);
          const withFtth = ftth && BUILDINGS[b] ? head.replace(BUILDINGS[b], `FTTH ${BUILDINGS[b]}`) : `${head}${ftth}`;
          const full = `${withFtth}, ${STREETS[s]}, ${AREAS[a]}, ${place.city}, ${place.state}, ${place.postcode}, Malaysia`;
          const business = UNITS[u].startsWith('LOT') || UNITS[u].startsWith('NO.') || (u + b) % 4 === 0;
          rows.push({
            case_no: `T-SYN-${String(n).padStart(3, '0')}`,
            provider: business ? 'TIME Business' : 'TIME FTTH',
            full_address: full,
          });
          n++;
        }
      }
    }
  }
  return rows;
}

async function main() {
  delete process.env.GOOGLE_MAPS_API_KEY;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const measure = (text: string) => font.widthOfTextAtSize(text, TIME_ADDRESS_FONT_SIZE);

  const kept: CaseRow[] = [];
  let failed = 0;
  for (const row of candidates()) {
    const packed = await buildInvoiceAddress(row.full_address, '', measure, TIME_ADDRESS_MAX_WIDTH);
    const lines = printedTimeAddress(packed);
    const audit = auditTimeBillAddress(row.full_address, lines);
    if (!audit.pass) {
      failed++;
      if (failed <= 12) {
        console.error('drop', row.case_no, audit, lines, row.full_address);
      }
      continue;
    }
    kept.push(row);
  }

  // The unit loop is the outer one, so the first rows are all `B-12-03A`.
  // Round-robin the units so the fixture actually contains LOT, NO., BLOK and
  // `2-T.12-U.01`, not two hundred copies of one condo unit.
  const seeds = kept.slice(0, 2);
  const buckets = new Map<string, CaseRow[]>();
  for (const row of kept.slice(2)) {
    const unit = UNITS.find((u) => row.full_address.startsWith(u)) ?? 'other';
    const list = buckets.get(unit) ?? [];
    list.push(row);
    buckets.set(unit, list);
  }
  const mixed: CaseRow[] = [...seeds];
  const keys = [...buckets.keys()];
  while (mixed.length < 240) {
    let added = false;
    for (const key of keys) {
      const list = buckets.get(key);
      const next = list?.shift();
      if (!next) continue;
      mixed.push(next);
      added = true;
      if (mixed.length >= 240) break;
    }
    if (!added) break;
  }
  const out = mixed.map((row, i) => ({
    ...row,
    case_no: `T-SYN-${String(i + 1).padStart(3, '0')}`,
  }));
  const target = path.join(process.cwd(), 'scripts/fixtures/time-address-cases.json');
  writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
  const home = out.filter((r) => r.provider === 'TIME FTTH').length;
  const business = out.filter((r) => r.provider === 'TIME Business').length;
  console.log(`kept ${kept.length} (dropped ${failed}), wrote ${out.length} home=${home} business=${business}`);
  if (out.length < 200) process.exit(1);
}

main();
