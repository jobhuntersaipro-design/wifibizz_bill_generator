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

export function partyFilled(p?: PartyIdentity | null): p is PartyIdentity {
  return !!p && p.name.trim().length > 0 && /\d{6}/.test(p.nric);
}

function asParty(
  person: { name: string; ic: string },
): PartyIdentity {
  return {
    name: person.name.toUpperCase(),
    nric: formatIcDashed(person.ic),
  };
}

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
