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
  // Replication clones set it deliberately; an ordinary clone of one must not
  // inherit a policy nobody chose for it.
  "autoRetryDisabled",
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

/**
 * The R2 key for a document COPIED into a replication clone.
 *
 * Deliberately not the key the order form would mint: that one is
 * `{idNumber}_{slug}_{n}` in the owner's namespace, so cloning into the SAME
 * account would write over the source order's own file (the trap above). The
 * copy keeps `{idNumber}_{slug}_` intact — `slugFromFilename` is how the form
 * knows which kinds are attached — and tags only the trailing segment.
 */
export function cloneDocumentKey(
  sourceFilename: string,
  targetUserId: string,
  tag: string,
): { key: string; filename: string } {
  const dot = sourceFilename.lastIndexOf(".");
  const stem = dot > 0 ? sourceFilename.slice(0, dot) : sourceFilename;
  const ext = dot > 0 ? sourceFilename.slice(dot) : "";
  const filename = `${stem}-c${tag}${ext}`;
  return { key: `orders/${targetUserId}/${filename}`, filename };
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  jfif: "image/jpeg", webp: "image/webp", bmp: "image/bmp",
};

/** Content type for a stored document, from its extension. */
export function documentContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}
