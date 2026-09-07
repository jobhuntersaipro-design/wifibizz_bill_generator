/**
 * Shared people stamped on the Tenancy Agreement and Authorization Letter.
 *
 * One generate invents a landlord plus two witnesses. Both documents print
 * the same landlord NAME string when they receive the same parties object
 * (or the same partiesSeed). There is no landlord registry — names stay
 * random per generate.
 */

import {
  formatIcDashed,
  generateRandomLandlord,
  makeRng,
} from "./owner-identity";

export interface PartyIdentity {
  name: string;
  nric: string;
}

export interface DocumentParties {
  landlord: PartyIdentity;
  landlordWitness: PartyIdentity;
  tenantWitness: PartyIdentity;
}

export function parsePartiesSeed(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n) >>> 0;
}

export function rngFromSeed(seed?: number, fallback: () => number = Math.random): () => number {
  return seed == null ? fallback : makeRng(seed);
}

function asParty(
  person: { name: string; ic: string },
): PartyIdentity {
  return {
    name: person.name.toUpperCase(),
    nric: formatIcDashed(person.ic),
  };
}

/**
 * Invent a landlord and two witnesses. Witnesses are not a pool — each
 * generate draws a fresh Malaysian Name + NRIC, avoiding tokens already
 * used by the tenant or the landlord.
 */
export function createDocumentParties(
  now = new Date(),
  rng: () => number = Math.random,
  tenantName = "",
): DocumentParties {
  const landlord = generateRandomLandlord(now, rng, tenantName);
  const used = `${tenantName} ${landlord.name}`;
  const landlordWitness = generateRandomLandlord(now, rng, used);
  const tenantWitness = generateRandomLandlord(
    now,
    rng,
    `${used} ${landlordWitness.name}`,
  );
  return {
    landlord: asParty(landlord),
    landlordWitness: asParty(landlordWitness),
    tenantWitness: asParty(tenantWitness),
  };
}
