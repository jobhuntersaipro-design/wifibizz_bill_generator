/**
 * The scraper's portal-message → error-code rules, mirrored for BizzFlow.
 *
 * The scraper classifies every dialog it reads with `map_error` in
 * `scraper/oe_errors.py`, but one path (a step that threw while a portal popup was
 * up) used to file the popup as a bare `portal_error`. That lost the code for
 * refusals the table already knew, e.g. "This address already has TM services
 * installed", and a code-less failure is retried automatically (ORD-0275 ran four
 * times against an address that can never take a new line). The droplet only
 * picks up a scraper fix on a manual deploy, so BizzFlow reclassifies generic
 * codes itself from the portal's own sentence.
 *
 * Kept in the SAME order as `_RULES` (first match wins). A test parses the Python
 * table and fails if the two drift.
 */
export const PORTAL_ERROR_RULES: ReadonlyArray<readonly [needle: string, code: string]> = [
  ["send otp", "pii_verification_required"],
  ["otp verification", "pii_verification_required"],
  ["blacklist", "blacklisted_ic"],
  ["black list", "blacklisted_ic"],
  ["out of stock", "device_out_of_stock"],
  ["no stock", "device_out_of_stock"],
  ["stock is not available", "device_out_of_stock"],
  ["slot has been taken", "appointment_slot_taken"],
  ["does not have any services provided by tm", "address_no_tm_service"],
  ["only offers services from other operators", "address_no_tm_service"],
  ["already has tm service", "address_already_has_service"],
  ["already has tm services", "address_already_has_service"],
  ["address already has", "address_already_has_service"],
  ["no record to view", "address_not_found"],
  ["address not found", "address_not_found"],
  ["maximum number of line", "msr_customer_id_limit"],
  ["max line", "msr_customer_id_limit"],
  ["customer id limit", "msr_customer_id_limit"],
  ["offline approve", "msr_offline_approval"],
  ["offline approval", "msr_offline_approval"],
  ["taken by another order", "voice_number_taken"],
  ["choose another number", "voice_number_taken"],
  ["login id already", "login_id_taken"],
  ["login id is taken", "login_id_taken"],
  ["already taken", "login_id_taken"],
  ["already in use", "login_id_taken"],
  ["login id", "login_id_invalid"],
  ["no number available", "vobb_unavailable"],
  ["number pool", "vobb_unavailable"],
  ["vobb", "vobb_unavailable"],
];

/** Codes that say "something failed" without saying what. */
const GENERIC_CODES = new Set(["portal_error", "unknown_error", "exception"]);

/** The code `map_error` would give this portal message, or null when none matches. */
export function classifyPortalMessage(message: string | null | undefined): string | null {
  const text = message?.trim().toLowerCase();
  if (!text) return null;
  for (const [needle, code] of PORTAL_ERROR_RULES) {
    if (text.includes(needle)) return code;
  }
  return null;
}

/**
 * The error code to record: the scraper's own code, unless it is a generic one and
 * the portal's message names a specific refusal.
 */
export function resolveErrorCode(
  code: string | null | undefined,
  message: string | null | undefined,
): string | null | undefined {
  // The scraper files a preferred date with no slot under its catch-all
  // `appointment_failed`; its own sentence ("no slots on 2026-10-12 …") names it.
  if (code === "appointment_failed" && /^no slots on \d{4}-\d{2}-\d{2}/.test(message ?? "")) {
    return "appointment_date_unavailable";
  }
  if (code && !GENERIC_CODES.has(code)) return code;
  return classifyPortalMessage(message) ?? code;
}
