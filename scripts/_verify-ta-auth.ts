import { mkdir, writeFile } from "node:fs/promises";
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { makeRng } from "../src/lib/bill-generator/owner-identity.ts";
import { createDocumentParties } from "../src/lib/bill-generator/document-parties.ts";
import { generateTenancyAgreement } from "../src/lib/bill-generator/tenancy-agreement.ts";
import { generateAuthorizationLetter } from "../src/lib/bill-generator/authorization-letter.ts";
import {
  SECTION4_CELL_RIGHT,
  SECTION4_CELL_BOTTOM,
  loadPageCmaps,
  extractTextRuns,
} from "../src/lib/bill-generator/tenancy-stamp.ts";
import { getPageStreamRefs, transformStream } from "../src/lib/bill-generator/pdf-utils.ts";

const CASE = {
  case_no: "202666996",
  full_name: "Nor Azzawani Fizatulazira Binti Zulkepeli",
  id_no: "011023120384",
  full_address:
    "LOT 978, JALAN KAMPUNG BARU, KAMPUNG SUNGAI BULOH, 47000 SUNGAI BULOH, SELANGOR, MALAYSIA",
};

const FROZEN = new Date("2026-09-05T12:00:00+08:00");
const SEED = 7;
const OUT = "/tmp/ta-auth-proof";

const PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

function pageRuns(pdf: PDFDocument, page: ReturnType<PDFDocument["getPages"]>[number]) {
  const cmaps = loadPageCmaps(pdf, page);
  const runs: { text: string; x: number; y: number; size: number }[] = [];
  for (const entry of getPageStreamRefs(pdf, page)) {
    transformStream(pdf, entry, (buf) => {
      for (const run of extractTextRuns(buf.toString("latin1"), cmaps)) {
        if (run.text.trim()) runs.push(run);
      }
      return { data: buf, count: 0 };
    });
  }
  return runs;
}

function visibleText(pdf: PDFDocument) {
  return pdf.getPages().flatMap((page) => pageRuns(pdf, page).map((r) => r.text)).join("\n");
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const parties = createDocumentParties(FROZEN, makeRng(SEED), CASE.full_name);
  const rng = makeRng(SEED);

  const taEmpty = await generateTenancyAgreement(CASE, undefined, FROZEN, rng, {
    parties,
    signature: null,
  });
  const letterEmpty = await generateAuthorizationLetter(CASE, FROZEN, {
    parties,
    signature: null,
  });
  const taSigned = await generateTenancyAgreement(CASE, undefined, FROZEN, makeRng(SEED), {
    parties,
    signature: { bytes: PIXEL_PNG, mime: "image/png" },
  });
  const letterSigned = await generateAuthorizationLetter(CASE, FROZEN, {
    parties,
    signature: { bytes: PIXEL_PNG, mime: "image/png" },
  });

  await writeFile(`${OUT}/ta-empty.pdf`, Buffer.from(taEmpty));
  await writeFile(`${OUT}/auth-empty.pdf`, Buffer.from(letterEmpty));
  await writeFile(`${OUT}/ta-signed.pdf`, Buffer.from(taSigned));
  await writeFile(`${OUT}/auth-signed.pdf`, Buffer.from(letterSigned));

  const taDoc = await PDFDocument.load(taEmpty);
  const letterDoc = await PDFDocument.load(letterEmpty);
  const taText = visibleText(taDoc);
  const letterText = visibleText(letterDoc);
  const font = await taDoc.embedFont(StandardFonts.TimesRomanBold);
  const schedule = taDoc.getPages()[taDoc.getPageCount() - 1];
  const premises = pageRuns(taDoc, schedule).filter(
    (r) =>
      /LOT 978|KAMPUNG SUNGAI BULOH|SELANGOR|MALAYSIA|SUNGAI BULOH/.test(r.text) &&
      r.y >= SECTION4_CELL_BOTTOM - 1 &&
      r.y <= 560 &&
      r.x >= 220,
  );
  const overflow = premises.filter((run) => {
    const right = run.x + font.widthOfTextAtSize(run.text, run.size);
    return right > SECTION4_CELL_RIGHT + 0.6 || run.y < SECTION4_CELL_BOTTOM - 0.6;
  });

  const exec = taDoc.getPages()[8];
  const execText = pageRuns(taDoc, exec).map((r) => r.text).join(" ");
  const signedTa = await PDFDocument.load(taSigned);
  const signedExec = signedTa.getPages()[8];
  const xobj = signedExec.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);

  const report = {
    landlord: parties.landlord,
    landlordWitness: parties.landlordWitness,
    tenantWitness: parties.tenantWitness,
    ac2_witnessesFilled:
      parties.landlordWitness.name.length > 0 &&
      parties.tenantWitness.name.length > 0 &&
      taText.includes(parties.landlordWitness.name) &&
      taText.includes(parties.tenantWitness.name) &&
      letterText.includes(parties.landlordWitness.name) &&
      letterText.includes(parties.tenantWitness.name),
    ac3_section4Inside: premises.length > 0 && overflow.length === 0,
    section4RunCount: premises.length,
    section4OverflowCount: overflow.length,
    ac4_landlordNameMatch:
      taText.includes(parties.landlord.name) &&
      letterText.includes(parties.landlord.name),
    ac6_emptyPoolStillGenerates: taDoc.getPageCount() > 0 && letterDoc.getPageCount() === 1,
    ac7_execHasLandlordAndWitnesses:
      execText.includes(parties.landlord.name) &&
      execText.includes(parties.landlordWitness.name) &&
      execText.includes(parties.tenantWitness.name),
    ac1_poolImageEmbedsOnExec: !!(xobj && [...xobj.keys()].length > 0),
    files: {
      taEmpty: `${OUT}/ta-empty.pdf`,
      authEmpty: `${OUT}/auth-empty.pdf`,
      taSigned: `${OUT}/ta-signed.pdf`,
      authSigned: `${OUT}/auth-signed.pdf`,
    },
  };

  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  const failed = (
    [
      "ac2_witnessesFilled",
      "ac3_section4Inside",
      "ac4_landlordNameMatch",
      "ac6_emptyPoolStillGenerates",
      "ac7_execHasLandlordAndWitnesses",
      "ac1_poolImageEmbedsOnExec",
    ] as const
  ).filter((k) => !report[k]);
  if (failed.length) {
    console.error("FAILED", failed);
    process.exit(1);
  }
  console.log("ALL_PDF_ACS_PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
