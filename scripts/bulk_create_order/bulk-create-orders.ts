/**
 * bulk-create-orders.ts — create draft orders from a file of REAL, hand-written
 * customer rows, with the same document attached to every one.
 *
 * Different from scripts/seed-orders.ts, which invents customers and asks the
 * portal which addresses are serviceable. Here the customer data and the address
 * are given, so nothing is generated and no portal call is made: the rows are
 * written exactly as typed, and whether the address sells is decided by the
 * submit — which is the thing being tested.
 *
 * What it does NOT do: submit. Rows are written as `draft` and left for a human
 * to submit from the Orders table, because every successful submit mints a real,
 * chargeable Unifi order.
 *
 * Per row:
 *   1. validate the address with the app's own validator (the order form would
 *      refuse to re-save a row that fails it, so a row nobody can edit is never
 *      written)
 *   2. derive gender + birthday from the MyKad, exactly as the form does
 *   3. upload ic_upload.png to R2 once per document type, under keys the
 *      authenticated /api/orders/document proxy can serve
 *   4. write one Order row
 *
 * Usage:
 *   npx tsx scripts/bulk_create_order/bulk-create-orders.ts --user <email> \
 *       [--file ./orders.json] [--doc ./ic_upload.png] \
 *       [--limit N] [--dry-run] [--no-docs] [--force]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../../src/generated/prisma/client";
import { ID_TYPES, MYKAD_LIKE_ID_TYPES } from "../../src/lib/dealer-offers";
import {
  normalizeAddress,
  parseMalaysianAddress,
  validateMalaysianAddress,
} from "../../src/lib/malaysia-address";
import { isValidEmail, parseMykad } from "../../src/lib/mykad";
import { hasIdentityDocument } from "../../src/lib/order-types";
import { uploadToR2 } from "../../src/lib/r2";
import { isWithDevice, pickOffer } from "../../src/lib/seed-offer";

const HERE = dirname(fileURLToPath(import.meta.url));

// Mirrors uploadOrderDocument's allowlist: the stored content-type comes from
// the extension, never from whatever the filesystem claims.
const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  bmp: "image/bmp",
  webp: "image/webp",
  pdf: "application/pdf",
};

// docType -> filename slug, same vocabulary the order form uploads under, so a
// draft written here is indistinguishable from one an agent filled in by hand.
const DOC_SLUG: Record<string, string> = {
  im_conversation: "imconversation",
  utility_bill: "utilitybill",
  mykad: "mykad",
  passport: "passport",
  id: "id",
  other: "doc",
};

interface OrderSpec {
  label?: string;
  idType?: string;
  idNumber: string;
  fullName: string;
  mobile?: string;
  mobilePrefix?: string;
  email?: string;
  street: string;
  offerName?: string;
  deviceCode?: string;
  deviceName?: string;
  remarks?: string;
  docTypes?: string[];
}

interface SpecFile {
  defaults?: Partial<OrderSpec>;
  orders: OrderSpec[];
}

interface Args {
  user: string;
  file: string;
  doc: string;
  limit: number;
  dryRun: boolean;
  noDocs: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const user = get("user");
  if (!user) {
    console.error(
      "Usage: tsx scripts/bulk_create_order/bulk-create-orders.ts --user <email> " +
        "[--file ./orders.json] [--doc ./ic_upload.png] [--limit N] [--dry-run] " +
        "[--no-docs] [--force]"
    );
    process.exit(1);
  }
  return {
    user,
    file: resolve(get("file") ?? `${HERE}/orders.json`),
    doc: resolve(get("doc") ?? `${HERE}/ic_upload.png`),
    limit: Number(get("limit") ?? 0) || Number.POSITIVE_INFINITY,
    dryRun: argv.includes("--dry-run"),
    noDocs: argv.includes("--no-docs"),
    force: argv.includes("--force"),
  };
}

/** Everything about a row that can be decided without touching R2 or the DB. */
function resolveSpec(spec: OrderSpec, defaults: Partial<OrderSpec>) {
  const merged = { ...defaults, ...spec } as OrderSpec;
  const idType = merged.idType ?? "MyKad";
  const problems: string[] = [];

  if (!(ID_TYPES as readonly string[]).includes(idType)) {
    problems.push(`unknown ID type "${idType}"`);
  }

  const idNumber = String(merged.idNumber ?? "").replace(/\s|-/g, "");
  if (!idNumber) problems.push("missing ID number");

  // Gender and birthday are DERIVED, never carried in the file: the portal sees
  // what the ID encodes, so a hand-typed value that disagreed would be a row
  // saying one thing and a submit doing another.
  let gender: string | null = null;
  let birthday: string | null = null;
  if (MYKAD_LIKE_ID_TYPES.includes(idType as (typeof MYKAD_LIKE_ID_TYPES)[number])) {
    const info = parseMykad(idNumber);
    if (!info) problems.push(`ID "${idNumber}" is not a parseable ${idType}`);
    else ({ gender, birthday } = info);
  }

  if (!merged.fullName?.trim()) problems.push("missing full name");
  if (merged.email && !isValidEmail(merged.email)) problems.push(`invalid email "${merged.email}"`);

  const mobile = String(merged.mobile ?? "").replace(/\D/g, "");
  if (merged.mobile && !mobile) problems.push(`invalid mobile "${merged.mobile}"`);

  const street = normalizeAddress(merged.street ?? "");
  const check = validateMalaysianAddress(street);
  if (!check.ok) problems.push(check.reason);
  const parts = parseMalaysianAddress(street);

  // pickOffer over a one-element list: it fills the category from the catalog
  // and, for a "With Device" bundle, the cheapest real device — the same choice
  // the seed script makes, and overridable per row in the file.
  const picked = merged.offerName ? pickOffer([merged.offerName], isWithDevice(merged.offerName)) : null;
  if (merged.offerName && !picked) problems.push(`offer "${merged.offerName}" is not a usable package`);

  const docTypes = (merged.docTypes ?? []).filter((t) => t in DOC_SLUG);
  for (const t of merged.docTypes ?? []) {
    if (!(t in DOC_SLUG)) problems.push(`unknown document type "${t}"`);
  }
  // The same rule saveOrder enforces. This script writes through prisma directly
  // rather than through the action, so the gate does not run here — and a row
  // written without an ID copy produces a draft the order form then refuses to
  // re-save, which is a worse outcome than refusing to write it now.
  if (!hasIdentityDocument(docTypes.map((type) => ({ type })))) {
    problems.push("no ID document — add \"mykad\" or \"passport\" to docTypes");
  }

  return {
    problems,
    idType,
    idNumber,
    gender,
    birthday,
    docTypes,
    data: {
      idType,
      idNumber,
      fullName: merged.fullName?.trim() ?? "",
      gender,
      birthday,
      nationality: "Malaysia",
      mobilePrefix: merged.mobilePrefix ?? "60",
      mobile: mobile || null,
      email: merged.email?.trim() || null,
      street,
      postcode: parts.postcode ?? null,
      city: parts.city ?? null,
      state: parts.state ?? null,
      country: "Malaysia",
      offerName: picked?.offerName ?? null,
      offerCategory: picked?.offerCategory ?? null,
      deviceCode: merged.deviceCode ?? picked?.deviceCode ?? null,
      deviceName: merged.deviceName ?? picked?.deviceName ?? null,
      remarks: merged.remarks ?? null,
      status: "draft",
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const spec = JSON.parse(readFileSync(args.file, "utf8")) as SpecFile;
  if (!Array.isArray(spec.orders) || spec.orders.length === 0) {
    console.error(`No orders in ${args.file}.`);
    process.exit(1);
  }

  // Read the document once, up front: if it is unreadable or the wrong type,
  // that is a fact about the whole run, not something to discover on row 3 with
  // two drafts already written.
  let docBytes: Buffer | null = null;
  let docExt = "";
  if (!args.noDocs) {
    docBytes = readFileSync(args.doc);
    docExt = (basename(args.doc).split(".").pop() || "").toLowerCase();
    if (!EXT_CONTENT_TYPE[docExt]) {
      console.error(`Unsupported document type .${docExt} — allowed: ${Object.keys(EXT_CONTENT_TYPE).join(", ")}`);
      process.exit(1);
    }
    if (docBytes.length > 5 * 1024 * 1024) {
      console.error("The document exceeds the portal's 5MB per-file limit.");
      process.exit(1);
    }
    if (!args.dryRun && !process.env.R2_BUCKET_NAME) {
      console.error("R2 is not configured (R2_BUCKET_NAME unset) — run with --no-docs, or fill in .env.");
      process.exit(1);
    }
  }

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const user = await prisma.user.findUnique({ where: { email: args.user } });
  if (!user) {
    console.error(`No BizzFlow user with email "${args.user}".`);
    process.exit(1);
  }

  console.log(
    `\nCreating drafts for ${user.email} from ${args.file}` +
      `${args.dryRun ? "  (dry run — nothing will be written or uploaded)" : ""}\n`
  );

  let written = 0;
  const skipped: string[] = [];

  for (const [i, raw] of spec.orders.entries()) {
    if (written >= args.limit) {
      console.log(`\nReached --limit ${args.limit}; ${spec.orders.length - i} row(s) not read.`);
      break;
    }
    const name = raw.label ?? raw.fullName ?? `row ${i + 1}`;
    console.log(`[${i + 1}/${spec.orders.length}] ${name}`);

    const r = resolveSpec(raw, spec.defaults ?? {});
    if (r.problems.length > 0) {
      console.log(`    skipped — ${r.problems.join("; ")}`);
      skipped.push(`${name} — ${r.problems.join("; ")}`);
      continue;
    }

    // One draft per ID unless told otherwise: re-running after a failure part
    // way through should top the set up, not double it, and a duplicate ID sends
    // a submit down the multiple-customer path instead of the one under test.
    if (!args.force) {
      const existing = await prisma.order.findFirst({
        where: { userId: user.id, idNumber: r.idNumber },
        select: { id: true, status: true },
      });
      if (existing) {
        const reason = `an order for ID ${r.idNumber} already exists (${existing.id}, ${existing.status}) — use --force to add another`;
        console.log(`    skipped — ${reason}`);
        skipped.push(`${name} — ${reason}`);
        continue;
      }
    }

    console.log(`    ${r.data.street}`);
    console.log(
      `    ${r.idType} ${r.idNumber} · ${r.gender ?? "?"} · ${r.birthday ?? "?"}` +
        ` · +${r.data.mobilePrefix}${r.data.mobile ?? ""}`
    );
    console.log(
      `    package: ${r.data.offerName ?? "(none)"}${r.data.deviceName ? ` + ${r.data.deviceName}` : ""}`
    );

    const documents: { type: string; url: string; key: string; filename: string }[] = [];
    for (const type of r.docTypes) {
      const filename = `${r.idNumber}_${DOC_SLUG[type]}_1.${docExt}`;
      const key = `orders/${user.id}/${filename}`;
      if (!args.dryRun && docBytes) {
        await uploadToR2(key, docBytes, EXT_CONTENT_TYPE[docExt] as string);
      }
      documents.push({
        type,
        url: `/api/orders/document?key=${encodeURIComponent(key)}`,
        key,
        filename,
      });
    }
    if (documents.length > 0) {
      console.log(`    documents: ${documents.map((d) => d.filename).join(", ")}`);
    }

    if (args.dryRun) {
      written += 1; // counts against --limit so a dry pass previews the same set
      continue;
    }

    const order = await prisma.order.create({
      data: { userId: user.id, ...r.data, documents },
    });
    written += 1;
    console.log(`    wrote draft ${order.id}`);
  }

  console.log(
    `\n${args.dryRun ? "Validated" : "Wrote"} ${written} order(s); ${skipped.length} skipped.`
  );
  for (const s of skipped) console.log(`  skipped: ${s}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
