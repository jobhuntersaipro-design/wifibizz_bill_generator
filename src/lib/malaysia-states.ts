// Malaysian states — normalized names for matching
export const MALAYSIA_STATES = [
  "Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan",
  "Pahang", "Perak", "Perlis", "Pulau Pinang", "Sabah",
  "Sarawak", "Selangor", "Terengganu",
  "Kuala Lumpur", "Putrajaya", "Labuan",
];

// Aliases for state matching
export const STATE_ALIASES: Record<string, string> = {
  "penang": "Pulau Pinang",
  "p.pinang": "Pulau Pinang",
  "pulau pinang": "Pulau Pinang",
  "pinang": "Pulau Pinang",
  "malacca": "Melaka",
  "n.sembilan": "Negeri Sembilan",
  "n. sembilan": "Negeri Sembilan",
  "negeri sembilan": "Negeri Sembilan",
  "ns": "Negeri Sembilan",
  "kl": "Kuala Lumpur",
  "kuala lumpur": "Kuala Lumpur",
  "w.p. kuala lumpur": "Kuala Lumpur",
  "wp kuala lumpur": "Kuala Lumpur",
  "wilayah persekutuan kuala lumpur": "Kuala Lumpur",
  "w.p. putrajaya": "Putrajaya",
  "wp putrajaya": "Putrajaya",
  "w.p. labuan": "Labuan",
  "wp labuan": "Labuan",
  "johor": "Johor",
  "johor bahru": "Johor",
  "jb": "Johor",
  "kedah": "Kedah",
  "kelantan": "Kelantan",
  "melaka": "Melaka",
  "pahang": "Pahang",
  "perak": "Perak",
  "perlis": "Perlis",
  "sabah": "Sabah",
  "sarawak": "Sarawak",
  "selangor": "Selangor",
  "terengganu": "Terengganu",
  "trengganu": "Terengganu",
  "labuan": "Labuan",
  "putrajaya": "Putrajaya",
};

export function extractState(address: string | null): string | null {
  if (!address) return null;

  const normalized = address.toLowerCase().trim();

  // Try matching state names from end of address (most addresses end with state)
  const parts = normalized.split(",").map((p) => p.trim());

  for (let i = parts.length - 1; i >= Math.max(0, parts.length - 3); i--) {
    const segment = parts[i]
      .replace(/\d{5}/, "") // remove postcode
      .replace(/malaysia/gi, "")
      .trim();

    if (STATE_ALIASES[segment]) return STATE_ALIASES[segment];

    for (const [alias, state] of Object.entries(STATE_ALIASES)) {
      if (segment.includes(alias)) return state;
    }
  }

  // Fallback: check whole address for state names (longest match first)
  const statesByLength = [...MALAYSIA_STATES].sort((a, b) => b.length - a.length);
  for (const state of statesByLength) {
    if (normalized.includes(state.toLowerCase())) return state;
  }

  return null;
}
