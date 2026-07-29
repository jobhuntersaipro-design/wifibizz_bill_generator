// Shared order types/constants usable from both client components and the
// "use server" actions file (which may only export async functions).

export const MAX_DOCS = 10;

export interface OrderDocument {
  type: string; // id | utility_bill | other
  url: string; // authenticated proxy path (/api/orders/document?key=...)
  key: string; // R2 object key, namespaced by userId (orders/<userId>/<filename>)
  filename: string;
}

// One serviceable address returned by the portal's QryNIGAddress search.
export interface AddressResult {
  addressId: string; // resourceInstId — used later to select "By Address Id"
  addressFull: string; // concatAddress (display)
  serviceCategory: string | null; // addrServiceCategory (FTTH, …)
  addressType: string | null; // Residential | Business
  houseType: string | null;
  state: string | null;
  city: string | null;
  postcode: string | null;
  streetName: string | null;
  streetType: string | null;
  section: string | null;
  buildingName: string | null;
  houseUnitLot: string | null;
}

// Exact `state` values the portal accepts (Select Address modal combobox).
export const ADDRESS_SEARCH_STATES = [
  "SELANGOR", "PAHANG", "KELANTAN", "JOHOR", "KEDAH", "MELAKA",
  "NEGERI SEMBILAN", "PERLIS", "PERAK", "PULAU PINANG", "SABAH", "SARAWAK",
  "TERENGGANU", "W.P. KUALA LUMPUR", "W.P. PUTRAJAYA", "W.P. LABUAN",
] as const;

export interface OrderListItem {
  id: string;
  fullName: string;
  idType: string;
  idNumber: string;
  offerName: string | null;
  city: string | null;
  state: string | null;
  status: string; // draft | submitting | submitted | failed
  orderId: string | null;
  errorMessage: string | null;
  docCount: number;
  createdAt: string;
}
