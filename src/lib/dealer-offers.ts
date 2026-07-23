// Unifi eSales dealer-portal Main Offers (Subscription Plan List), transcribed
// from the portal screenshots. "Unifi Home Shield ..." offers are intentionally
// excluded (no longer active). Names must match the portal's grid text exactly
// so the backend can select the row — verify against the live portal when in
// doubt. Grouped by the portal's offer category.

export interface DealerOffer {
  category: string;
  name: string;
  bandwidth: string;
}

export const OFFER_CATEGORIES = {
  HOME: "unifi Home Bundle Sale Catg",
  BIZ: "unifi Biz Bundle Sale Catg",
  VOF: "VOF Sales Catg",
} as const;

export const DEALER_OFFERS: DealerOffer[] = [
  // ── unifi Home Bundle Sale Catg ────────────────────────────────────────────
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 1Gbps Broadband", bandwidth: "1G" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 500Mbps - Home Broadband", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 300Mbps - Home Broadband", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 100Mbps Broadband (24M)", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 2Gbps - Home Broadband with Netflix", bandwidth: "2G" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 100Mbps Broadband with Netflix (24M)", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 1Gbps Broadband with Netflix (24M)", bandwidth: "1G" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 500Mbps - Home Broadband with Netflix", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 2Gbps - Home Broadband", bandwidth: "2G" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 100Mbps Home Plus with UNI5G39 (1SIM)", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 100Mbps Home Plus with UNI5G39 (2SIM)", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 300Mbps Home Plus with UNI5G39 (1SIM)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 300Mbps Home Plus with UNI5G39 (2SIM)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 100Mbps Home Plus with UNI5G 69", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 100Mbps PrimePromo (27M)", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 300Mbps PrimePromo (27M)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 300Mbps Home with MAX (24M)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 300Mbps Home with Netflix (24M)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 1Gbps Premium Value with MAX (27M)", bandwidth: "1G" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 1Gbps Premium Value (30M)", bandwidth: "1G" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 500Mbps Home Plus UNI5G 39 with Value TV Pack 30", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 500Mbps Home Plus with Value TV Pack 30", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 100Mbps Home Plus with Value TV Pack 60", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 300Mbps Home Plus with Value TV Pack 60", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 500Mbps Home Plus with Value TV Pack 60", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 1Gbps Value Broadband with Netflix (24M)", bandwidth: "1G" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 300Mbps Home Plus with UNI5G 69", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 500Mbps Home Plus with UNI5G 69", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 500Mbps Home Plus with UNI5G 39 (1SIM)", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 500Mbps Home Plus with UNI5G 39 (2SIM)", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 300Mbps Broadband with Value Pack 60 (24M)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 300Mbps Home Plus with Value TV Pack 30", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 100Mbps Home Plus with Value TV Pack 30", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 300Mbps Home Plus UNI5G 39 with Value TV Pack 30", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 100Mbps Home Plus UNI5G 39 with Value TV Pack 30", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 500Mbps PrimePromo (27M)", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 300Mbps Premium Value with Device (36M)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 300Mbps Premium Value MAX With Device (36M)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 300Mbps Premium Value Netflix With Device (36M)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 300Mbps Premium Value with Netflix (27M)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 100Mbps Premium Value with Netflix (27M)", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 500Mbps Premium Value with Netflix (27M)", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 100Mbps Premium Value with MAX (27M)", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 300Mbps Premium Value with MAX (27M)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 500Mbps Premium Value with MAX (27M)", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 300Mbps Premium Value (30M)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 500Mbps Premium Value (30M)", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 1Gbps Value Broadband (24M)", bandwidth: "1G" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 1Gbps Premium Value Netflix With Device (36M)", bandwidth: "1G" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 1Gbps Premium Value MAX With Device (36M)", bandwidth: "1G" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 1Gbps Premium Value With Device (36M)", bandwidth: "1G" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 100Mbps Premium Value (36M)", bandwidth: "100M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 500Mbps Premium Value With Device (36M)", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 500Mbps Premium Value MAX With Device (36M)", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi Home 500Mbps Premium Value Netflix With Device (36M)", bandwidth: "500M" },
  { category: OFFER_CATEGORIES.HOME, name: "Unifi 100Mbps Home Lite with Max (24M)", bandwidth: "100M" },

  // ── unifi Biz Bundle Sale Catg ─────────────────────────────────────────────
  { category: OFFER_CATEGORIES.BIZ, name: "Unifi Business 300Mbps (MESH6)", bandwidth: "300M" },
  { category: OFFER_CATEGORIES.BIZ, name: "Unifi Business 500Mbps (MESH6)", bandwidth: "500M" },

  // ── VOF Sales Catg ─────────────────────────────────────────────────────────
  { category: OFFER_CATEGORIES.VOF, name: "VOF Consumer Bundle", bandwidth: "1M" },
  { category: OFFER_CATEGORIES.VOF, name: "VOF SME Bundle", bandwidth: "1M" },
];

export const ID_TYPES = ["MyKad", "MyKAS", "MyTentera", "MyPR", "I-KAD", "Passport"] as const;
export type IdType = (typeof ID_TYPES)[number];

// The Malaysian 12-digit IDs whose first 6 digits encode DOB and last digit
// encodes gender — only these allow auto-deriving gender/birthday from the ID.
export const MYKAD_LIKE_ID_TYPES: IdType[] = ["MyKad", "MyKAS", "MyTentera"];
