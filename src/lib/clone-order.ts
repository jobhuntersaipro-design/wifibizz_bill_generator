/**
 * What a CLONE copies from a source order — pinned as one explicit list.
 *
 * Everything here is the customer and what they are buying; nothing here is
 * run state. A new Order column added later must be placed on one side of this
 * line deliberately — the test suite walks this list, so joining or missing
 * the clone cannot happen silently.
 *
 * Documents are the load-bearing exclusion: R2 keys are
 * `orders/{userId}/{idNumber}_{slug}_{n}`, the documented trap where two orders
 * for one customer mint the SAME key and the second upload silently replaces
 * the first. Sharing entries across clones would turn that latent trap into a
 * certainty, so a clone's Documents card starts empty.
 */

export const CLONED_FIELDS = [
  "idType",
  "idNumber",
  "idExpiry",
  "fullName",
  "gender",
  "birthday",
  "race",
  "nationality",
  "mobilePrefix",
  "mobile",
  "email",
  "street",
  "postcode",
  "city",
  "state",
  "country",
  "addressId", // the portal's own unit id — exactly what a same-address clone wants
  "addressFull",
  "serviceCategory",
  "offerCategory",
  "offerName",
  "deviceCode",
  "deviceName",
  "remarks",
  "appointmentLeadHours",
] as const;

export type ClonedField = (typeof CLONED_FIELDS)[number];

/** Run state and identity a clone must NEVER carry. Named so the test can
 * assert the two lists are disjoint and jointly deliberate. */
export const NEVER_CLONED = [
  "id", "reference", "status", "attempt", "autoRetries", "autoRetryAt", "orderId",
  "errorMessage", "errorCode", "jobId", "stage", "stageAt", "screenshotUrl",
  "documents", "notifiedAt", "outcomeSeenAt", "deletedAt", "lastSubmitUserId",
  "userId", "createdAt", "updatedAt",
] as const;

export function cloneOrderInput<T extends Record<string, unknown>>(
  source: T,
): Pick<T, Extract<keyof T, ClonedField>> {
  const out: Record<string, unknown> = {};
  for (const f of CLONED_FIELDS) {
    if (f in source) out[f] = source[f];
  }
  return out as Pick<T, Extract<keyof T, ClonedField>>;
}
