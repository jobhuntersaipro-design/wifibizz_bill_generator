// Dummy customer details for seeded test drafts.
//
// These rows exist so a live submit has something to run against — the account's
// real drafts all sit on an address the portal refuses. The data is fake; the
// row in the database is not, so every field is generated to be *coherent*
// rather than merely non-empty: the ID parses, the birthday it encodes is a real
// date, and the derived gender agrees with it. A draft that fails the portal's
// own validation would test the validation, not the submit.
//
// Pure — no I/O, no randomness that a caller cannot control. `seedCustomer` is
// deterministic in `n`, so a rerun produces the same people and a report can be
// compared against an earlier one.

import { parseMykad } from "@/lib/mykad";

export interface SeedCustomer {
  idType: "MyKad";
  idNumber: string;
  fullName: string;
  gender: "Male" | "Female";
  birthday: string; // dd-mm-yyyy
  race: "Malay" | "Chinese" | "Indian" | "Others";
  nationality: string;
  mobilePrefix: string;
  mobile: string;
  email: string;
}

// Obviously-fictional names. Kept deliberately unlike real customer names so a
// seeded row is recognisable at a glance in the Orders table.
const NAMES = [
  "TEST ALPHA BIN SEED",
  "TEST BRAVO BINTI SEED",
  "TEST CHARLIE BIN SEED",
  "TEST DELTA BINTI SEED",
  "TEST ECHO BIN SEED",
  "TEST FOXTROT BINTI SEED",
  "TEST GOLF BIN SEED",
  "TEST HOTEL BINTI SEED",
];

// The marker that tells a human this row was generated. Read by nothing — the
// point is that a person reading the Orders table can see it.
export const SEED_REMARK = "SEED DRAFT — generated test data, not a real customer.";

const STATE_CODES = ["01", "10", "12", "14"]; // birth-state digits; any valid pair works

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * A 12-digit MyKad-like ID encoding a real birthdate.
 *
 * Uniqueness matters more than it looks: a repeated ID sends the submit down
 * the `multiple_customer_records` path, which is a DIFFERENT code path from the
 * one these drafts exist to exercise — the run would pass while proving nothing.
 * The last four digits carry `n`, so two customers from one run can never
 * collide, and `runId` separates one run's people from the next.
 */
export function seedIdNumber(n: number, runId: number): string {
  // Birthdays land in 1980-1999: adult, unambiguous under parseMykad's century
  // rule (a 20xx reading would be in the future), and a real calendar date —
  // days are capped at 28 so February is never invalid.
  const year = 1980 + (n % 20);
  const month = 1 + ((n * 7) % 12);
  const day = 1 + ((n * 11) % 28);
  const stateCode = STATE_CODES[n % STATE_CODES.length] as string;
  const serial = pad((runId * 13 + n * 3) % 10000, 4);
  return `${pad(year % 100, 2)}${pad(month, 2)}${pad(day, 2)}${stateCode}${serial}`;
}

/**
 * The nth dummy customer of a run.
 *
 * `runId` should differ between runs (the caller passes a timestamp-derived
 * value) so repeated seeding does not reissue the same IDs. Gender and birthday
 * are read back out of the generated ID with the app's own `parseMykad` rather
 * than tracked alongside it — if the two ever disagreed, the portal would see
 * the parsed values and our row would say something else.
 */
export function seedCustomer(n: number, runId: number): SeedCustomer {
  const idNumber = seedIdNumber(n, runId);
  const parsed = parseMykad(idNumber);
  if (!parsed) {
    // Unreachable by construction; a throw here means seedIdNumber's date
    // arithmetic drifted, which must never reach the portal as a live order.
    throw new Error(`Generated an unparseable MyKad: ${idNumber}`);
  }
  return {
    idType: "MyKad",
    idNumber,
    fullName: NAMES[n % NAMES.length] as string,
    gender: parsed.gender,
    birthday: parsed.birthday,
    race: "Malay",
    nationality: "Malaysia",
    mobilePrefix: "60",
    // Malaysian mobile shape: 1x plus seven digits, after the 60 country code.
    mobile: `1${(n % 9) + 1}${pad((runId * 7 + n * 17) % 10000000, 7)}`,
    email: `seed.test+${runId}-${n}@example.com`,
  };
}
