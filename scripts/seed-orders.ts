/**
 * seed-orders.ts — create draft orders whose installation address the Unifi
 * portal has actually confirmed it sells at.
 *
 * Why: every existing draft on the account sits on the BSP 21 building, which
 * the portal answers with "only offers services from other operators", so a
 * submit dies at the plan step before it exercises anything. These drafts give a
 * live submit something to run against.
 *
 * What it does NOT do: submit. Rows are written as `draft` and left for a human
 * to submit from the Orders table, because every successful submit mints a real,
 * chargeable Unifi order.
 *
 * Per address, against the portal:
 *   1. /dealer/address-search  → candidates carrying addressId + concatAddress
 *   2. /dealer/feasibility-probe → the offers the portal lists at that address id
 *   3. write one Order, package taken from those offers
 *
 * Both portal calls are read-only: no customer profile, no order number.
 *
 * Usage:
 *   npx tsx scripts/seed-orders.ts --user <email> --addresses ./addresses.txt \
 *       [--limit N] [--probe-only] [--with-device]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  normalizeAddress,
  parseMalaysianAddress,
  toPortalState,
  validateMalaysianAddress,
} from "../src/lib/malaysia-address";
import { keywordCandidates } from "../src/lib/seed-address-keywords";
import { SEED_REMARK, seedCustomer } from "../src/lib/seed-customer";
import { pickOffer } from "../src/lib/seed-offer";

// How many of a keyword search's candidate addresses get probed before the line
// is given up on. Each probe drives a real browser on the scraper host, so this
// is a cost ceiling — when it truncates, the run says so rather than letting the
// address look unserviceable when it was merely further down the list.
const MAX_CANDIDATES = 3;

interface Args {
  user: string;
  addresses: string;
  limit: number;
  probeOnly: boolean;
  withDevice: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const user = get("user");
  const addresses = get("addresses");
  if (!user || !addresses) {
    console.error(
      "Usage: tsx scripts/seed-orders.ts --user <email> --addresses <file> " +
        "[--limit N] [--probe-only] [--with-device]"
    );
    process.exit(1);
  }
  return {
    user,
    addresses,
    limit: Number(get("limit") ?? 0) || Number.POSITIVE_INFINITY,
    probeOnly: argv.includes("--probe-only"),
    withDevice: argv.includes("--with-device"),
  };
}

const SCRAPER_URL = process.env.SCRAPER_API_URL ?? "http://localhost:5000";
const TOKEN = process.env.ORDER_ENTRY_API_TOKEN ?? "";

/** A scraper call that separates "reconnect" from "this address is no good". */
class SessionExpired extends Error {}

async function callScraper(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${SCRAPER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN },
    body: JSON.stringify(body),
    // Each of these drives a browser through several portal pages.
    signal: AbortSignal.timeout(180_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 || res.status === 403) {
    throw new SessionExpired(
      "The scraper refused the token — check ORDER_ENTRY_API_TOKEN matches the service."
    );
  }
  if (res.status === 409 || res.status === 502) {
    throw new SessionExpired(
      String(json.message ?? "No usable dealer session — reconnect on the Order Entry page.")
    );
  }
  return json;
}

interface Candidate {
  addressId: string;
  addressFull: string;
  serviceCategory?: string;
}

async function findCandidates(
  userKey: string,
  portalState: string,
  stateName: string,
  line: string
): Promise<Candidate[]> {
  for (const value of keywordCandidates(line, stateName)) {
    const res = await callScraper("/dealer/address-search", {
      user_key: userKey,
      state: portalState,
      value,
      query_by: "keyword",
    });
    const found = (res.addresses as Candidate[] | undefined) ?? [];
    const usable = found.filter((a) => a.addressId && a.addressFull);
    if (usable.length > 0) {
      if (usable.length > MAX_CANDIDATES) {
        console.log(
          `    ${usable.length} candidates for "${value}" — probing the first ${MAX_CANDIDATES}`
        );
      }
      return usable.slice(0, MAX_CANDIDATES);
    }
  }
  return [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!TOKEN) {
    console.error("ORDER_ENTRY_API_TOKEN is not set — the scraper will refuse every call.");
    process.exit(1);
  }

  const lines = readFileSync(args.addresses, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  if (lines.length === 0) {
    console.error(`No addresses in ${args.addresses}.`);
    process.exit(1);
  }

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const user = await prisma.user.findUnique({ where: { email: args.user } });
  if (!user) {
    console.error(`No BizzFlow user with email "${args.user}".`);
    process.exit(1);
  }

  // Separates one run's generated IDs from the next, so reseeding never reissues
  // an ID and sends a submit down the duplicate-customer path.
  const runId = Math.floor(Date.now() / 1000) % 100000;

  console.log(
    `\nSeeding for ${user.email} via ${SCRAPER_URL}` +
      `${args.probeOnly ? "  (probe only — nothing will be written)" : ""}\n`
  );

  let written = 0;
  const skipped: string[] = [];

  for (const [i, line] of lines.entries()) {
    if (written >= args.limit) {
      console.log(`\nReached --limit ${args.limit}; ${lines.length - i} address(es) not read.`);
      break;
    }
    console.log(`[${i + 1}/${lines.length}] ${line}`);

    const check = validateMalaysianAddress(line);
    if (!check.ok) {
      console.log(`    skipped — ${check.reason}`);
      skipped.push(`${line} — ${check.reason}`);
      continue;
    }
    const parts = parseMalaysianAddress(line);
    const portalState = parts.state ? toPortalState(parts.state) : null;
    if (!portalState) {
      const reason = `no portal state for "${parts.state ?? "?"}"`;
      console.log(`    skipped — ${reason}`);
      skipped.push(`${line} — ${reason}`);
      continue;
    }

    const candidates = await findCandidates(user.id, portalState, parts.state ?? "", line);
    if (candidates.length === 0) {
      console.log("    skipped — the portal's address search returned nothing");
      skipped.push(`${line} — not found by address search`);
      continue;
    }

    let serviceable: { candidate: Candidate; offers: string[] } | null = null;
    let lastReason = "";
    for (const candidate of candidates) {
      const res = await callScraper("/dealer/feasibility-probe", {
        user_key: user.id,
        state: portalState,
        address_id: candidate.addressId,
      });
      const offers = (res.offers as string[] | undefined) ?? [];
      if (res.serviceable && offers.length > 0) {
        serviceable = { candidate, offers };
        break;
      }
      lastReason = String(res.message ?? "the portal listed no offers");
      console.log(`    ${candidate.addressFull} — no offers`);
    }

    if (!serviceable) {
      console.log(`    skipped — ${lastReason}`);
      skipped.push(`${line} — ${lastReason}`);
      continue;
    }

    const picked = pickOffer(serviceable.offers, args.withDevice);
    if (!picked) {
      console.log("    skipped — the portal listed offers but none were readable");
      skipped.push(`${line} — no readable offer`);
      continue;
    }

    // The portal's own address text, which is what the submit will match on.
    const portalAddress = normalizeAddress(serviceable.candidate.addressFull);
    const addressCheck = validateMalaysianAddress(portalAddress);
    if (!addressCheck.ok) {
      // The row would exist but the order form would refuse to re-save it —
      // a draft nobody can edit is worse than one that was never written.
      const reason = `the portal's address fails our own validation — ${addressCheck.reason}`;
      console.log(`    skipped — ${reason}`);
      skipped.push(`${line} — ${reason}`);
      continue;
    }

    console.log(`    ✓ ${portalAddress}`);
    console.log(`      offers: ${serviceable.offers.join(" | ")}`);
    console.log(`      picked: ${picked.offerName}${picked.deviceName ? ` + ${picked.deviceName}` : ""}`);

    if (args.probeOnly) {
      written += 1; // counts against --limit so a dry pass previews the same set
      continue;
    }

    const customer = seedCustomer(written, runId);
    const portalParts = parseMalaysianAddress(portalAddress);
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        ...customer,
        street: portalAddress,
        addressFull: serviceable.candidate.addressFull,
        addressId: serviceable.candidate.addressId,
        serviceCategory: serviceable.candidate.serviceCategory ?? null,
        postcode: portalParts.postcode ?? null,
        city: portalParts.city ?? null,
        state: portalParts.state ?? null,
        country: "Malaysia",
        offerName: picked.offerName,
        offerCategory: picked.offerCategory,
        deviceCode: picked.deviceCode ?? null,
        deviceName: picked.deviceName ?? null,
        remarks: SEED_REMARK,
        status: "draft",
      },
    });
    written += 1;
    console.log(`      wrote draft ${order.id} for ${customer.fullName}`);
  }

  console.log(
    `\n${args.probeOnly ? "Verified" : "Wrote"} ${written} order(s); ${skipped.length} skipped.`
  );
  for (const s of skipped) console.log(`  skipped: ${s}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  if (e instanceof SessionExpired) {
    // Every remaining address would fail the same way, so stopping is the
    // honest outcome rather than a page of identical failures.
    console.error(`\nStopped: ${e.message}`);
    process.exit(2);
  }
  console.error(e);
  process.exit(1);
});
