/**
 * The invented property owner who signs the authorization letter.
 *
 * The case record holds one person — the customer, who the letter names as the
 * *resident*. The owner vouching for them does not exist and is generated here.
 *
 * Everything is derived from a seed rather than `Math.random()`. The letter is
 * never stored, so an agent who downloads it twice would otherwise get two
 * different owners for the same premise and could submit both. Seeding on the
 * case number makes regeneration reproducible at zero storage cost.
 */

/** FNV-1a. Small, stable across runs, and good enough to spread the pools. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — deterministic, uniform enough for picking from a list. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length) % list.length];
}

// English given name + Chinese romanised surname — the shape the letter asks for.
const FEMALE_NAMES = [
  'Kelly', 'Chloe', 'Michelle', 'Jasmine', 'Vivian', 'Cindy', 'Grace',
  'Amanda', 'Serene', 'Rachel', 'Emily', 'Joanne', 'Shirley', 'Melissa',
  'Karen', 'Yvonne', 'Doris', 'Fiona', 'Sharon', 'Peggy',
] as const;

const MALE_NAMES = [
  'Ken', 'Martin', 'Kelvin', 'Jason', 'Alvin', 'Desmond', 'Terence',
  'Wilson', 'Andrew', 'Marcus', 'Ivan', 'Bryan', 'Nelson', 'Gary',
  'Eric', 'Vincent', 'Simon', 'Roger', 'Dennis', 'Leonard',
] as const;

const SURNAMES = [
  'Lam', 'Lee', 'Goh', 'Tan', 'Wong', 'Chan', 'Ng', 'Lim', 'Chong', 'Yap',
  'Chua', 'Teoh', 'Khoo', 'Sim', 'Foo', 'Ho', 'Koh', 'Loh', 'Ong', 'Toh',
] as const;

// MyKad birth-state codes 01–16: the 13 states plus KL, Labuan and Putrajaya.
const BIRTH_STATE_CODES = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(2, '0'));

export interface OwnerIdentity {
  name: string;
  /** 12 digits, no separators. */
  ic: string;
  gender: 'male' | 'female';
}

/** Whole-token test — "LEE" must not match "LEELA". */
function nameContainsToken(name: string, token: string): boolean {
  return new RegExp(`\\b${token}\\b`, 'i').test(name || '');
}

/**
 * The owner for a case: same case number in, same owner out.
 *
 * A surname that already appears in the customer's own name is redrawn, so the
 * owner never reads as the customer's own relative — which would undercut the
 * point of an arm's-length authorization.
 */
export function generateOwner(caseNo: string, customerName: string, now = new Date()): OwnerIdentity {
  const rng = makeRng(hashSeed(`owner:${caseNo}`));

  const gender: 'male' | 'female' = rng() < 0.5 ? 'female' : 'male';
  const given = pick(rng, gender === 'female' ? FEMALE_NAMES : MALE_NAMES);

  let surname = pick(rng, SURNAMES);
  // Bounded: with 20 surnames a collision is rare, and after this many tries the
  // draw is accepted rather than looping on a pathological customer name.
  for (let i = 0; i < 8 && nameContainsToken(customerName, surname); i++) {
    surname = pick(rng, SURNAMES);
  }

  return { name: `${given} ${surname}`, ic: generateOwnerIc(rng, gender, now), gender };
}

/**
 * A MyKad-shaped number for the owner: `YYMMDD` + birth-state code + 4 digits,
 * with the final digit's parity matching the gender the name was drawn for, so
 * the number does not contradict the person it belongs to.
 *
 * The birth-state code is deliberately NOT forced to match the premise state —
 * people move, and an owner whose IC always matched the address would be the
 * more obvious pattern.
 */
function generateOwnerIc(rng: () => number, gender: 'male' | 'female', now: Date): string {
  const age = 35 + Math.floor(rng() * 31); // 35–65
  const year = now.getFullYear() - age;
  const month = 1 + Math.floor(rng() * 12);
  // 28 days keeps every generated date a real one in every month, February included.
  const day = 1 + Math.floor(rng() * 28);

  const pb = pick(rng, BIRTH_STATE_CODES);

  const first3 = String(Math.floor(rng() * 1000)).padStart(3, '0');
  let last = Math.floor(rng() * 10);
  const wantOdd = gender === 'male';
  if (wantOdd !== (last % 2 === 1)) last = (last + 1) % 10;

  const yy = String(year % 100).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yy}${mm}${dd}${pb}${first3}${last}`;
}

/** `911225055166` → `911225-05-5166`. Anything not 12 digits is returned unchanged. */
export function formatIcDashed(ic: string): string {
  const d = (ic || '').replace(/\D/g, '');
  if (d.length !== 12) return (ic || '').trim();
  return `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

/** The undashed form the letter's body sentence uses. */
export function icDigits(ic: string): string {
  return (ic || '').replace(/\D/g, '');
}

// Malay given + father's name — the shape a Malaysian tenancy agreement prints.
const MALAY_MALE_FIRST = [
  'AHMAD', 'MUHAMMAD', 'HAFIZ', 'FARID', 'IZWAN', 'RIZAL', 'AMIR', 'FAISAL',
  'HAKIM', 'KAMAL', 'AZLAN', 'SYAFIQ', 'IRFAN', 'DANIAL', 'HAZIQ', 'KHAIRUL',
] as const;

const MALAY_FEMALE_FIRST = [
  'SITI', 'NUR', 'AIN', 'FARAH', 'NADIA', 'AINA', 'AMIRA', 'LINA', 'HANA',
  'INTAN', 'DIYANA', 'AFIQAH', 'BALQIS', 'NOR', 'FATIMAH', 'AISYAH',
] as const;

const MALAY_MALE_MIDDLE = [
  'HAIKAL', 'IMRAN', 'LUQMAN', 'HARITH', 'RAFIQ', 'ZAKWAN', 'IRSYAD', 'AKMAL',
] as const;

const MALAY_FEMALE_MIDDLE = [
  'ADIYANTI', 'AZIZAH', 'HANI', 'SYAFIQA', 'AMIRAH', 'IZZATI', 'FARHANA', 'SYAHIRA',
] as const;

const MALAY_FATHER = [
  'ABDULLAH', 'HASSAN', 'IBRAHIM', 'ISMAIL', 'RAHMAN', 'YUSOF', 'OMAR', 'AZIZ',
  'LATIF', 'HAMID', 'RAZAK', 'SALLEH', 'MAHMUD', 'ZAINAL', 'ADNAN', 'OTHMAN',
] as const;

/**
 * A landlord invented for a tenancy agreement.
 *
 * Unlike `generateOwner`, this is NOT seeded on the case number. The TA is
 * downloaded and discarded (never stored), and the product rule is that two
 * clicks must not print the same landlord. Callers that need a fixed person
 * for a test pass their own `rng`.
 */
export function generateRandomLandlord(
  now = new Date(),
  rng: () => number = Math.random,
  tenantName = '',
): OwnerIdentity {
  const gender: 'male' | 'female' = rng() < 0.5 ? 'female' : 'male';
  const first = pick(rng, gender === 'female' ? MALAY_FEMALE_FIRST : MALAY_MALE_FIRST);
  const middle = pick(rng, gender === 'female' ? MALAY_FEMALE_MIDDLE : MALAY_MALE_MIDDLE);
  const particle = gender === 'female' ? 'BINTI' : 'BIN';

  let father = pick(rng, MALAY_FATHER);
  for (let i = 0; i < 8 && nameContainsToken(tenantName, father); i++) {
    father = pick(rng, MALAY_FATHER);
  }

  return {
    name: `${first} ${middle} ${particle} ${father}`,
    ic: generateOwnerIc(rng, gender, now),
    gender,
  };
}

