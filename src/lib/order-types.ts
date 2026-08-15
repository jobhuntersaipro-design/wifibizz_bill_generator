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

// ── Submit progress ──────────────────────────────────────────────────────────
// The ordered steps a submit passes through. Keys match the stage names the
// scraper emits via on_stage(); the labels live here so the scraper stays free
// of user-facing copy.
//
// The first two run in BizzFlow before any portal call — they are the only two
// whose failure leaves nothing behind in the portal, which is why they are worth
// showing even though they flash by.
export interface SubmitStep {
  key: string;
  label: string;
}

export const SUBMIT_STEPS: SubmitStep[] = [
  { key: "validating_draft", label: "Checking draft" },
  { key: "checking_session", label: "Verifying dealer session" },
  { key: "creating_customer", label: "Creating customer profile" },
  { key: "checking_address", label: "Checking installation address" },
  { key: "checking_plan", label: "Checking package availability" },
  { key: "placing_order", label: "Placing order" },
  { key: "attaching_customer", label: "Attaching customer" },
  { key: "capturing_order_no", label: "Capturing order number" },
  { key: "installation_contact", label: "Setting installation contact" },
  { key: "billing_account", label: "Setting billing account" },
  { key: "winback_tagging", label: "Winback tagging" },
  { key: "selecting_device", label: "Selecting device" },
  { key: "uploading_attachments", label: "Uploading documents" },
  { key: "appointment", label: "Booking appointment" },
  { key: "delivery_terms", label: "Delivery details" },
  { key: "pay", label: "Payment" },
];

// Everything from here on has an order id in the portal: a failure after this
// step is NOT retryable, it needs verifying in the portal by hand.
export const POINT_OF_NO_RETURN = "capturing_order_no";

// Coarse stage keys older scraper builds emit, mapped onto the step they begin.
// Vercel and the droplet deploy separately, so a BizzFlow that is ahead of the
// scraper must still show sensible progress instead of falling off the list.
const STAGE_ALIASES: Record<string, string> = {
  order_entered: "checking_address",
  feasibility: "checking_address",
  new_connection_page1: "installation_contact",
  subproduct_tabs: "selecting_device",
  customer_order_info: "uploading_attachments",
};

/**
 * Index of the step a stage key refers to, or -1 when the key is unknown.
 *
 * An unknown key is not an error: the scraper may be AHEAD of this deploy and
 * emitting a stage added later. Callers render those as a generic "Working…"
 * rather than dropping progress or throwing.
 */
export function stepIndexForStage(stage: string | null | undefined): number {
  if (!stage) return -1;
  const key = STAGE_ALIASES[stage] ?? stage;
  return SUBMIT_STEPS.findIndex((s) => s.key === key);
}

export interface OrderListItem {
  id: string;
  fullName: string;
  idType: string;
  idNumber: string;
  offerName: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  state: string | null;
  // The portal's own concatAddress, written back when the address was confirmed
  // against Unifi — its presence (with addressId) is what "verified" means here.
  addressFull: string | null;
  addressId: string | null;
  status: string; // draft | submitting | order_entered | submitted | warning | failed
  orderId: string | null;
  errorMessage: string | null;
  stage: string | null; // last submit stage key seen — drives the step checklist
  docCount: number;
  createdAt: string;
  createdByEmail?: string | null; // only populated for superadmins (all-drafts view)
}
