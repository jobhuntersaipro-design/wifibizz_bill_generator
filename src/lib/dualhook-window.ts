/** Meta's customer-service window: free-form messages only within 24h of the customer's last message. */
export const SEND_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True while the customer's last message is under 24 hours old. Pure, safe in the browser. */
export function windowOpen(lastInboundAt: Date | string | null | undefined, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  const at = new Date(lastInboundAt).getTime();
  return Number.isFinite(at) && now.getTime() - at < SEND_WINDOW_MS;
}

export const WINDOW_CLOSED_MESSAGE =
  "The customer's last message is more than 24 hours old, so WhatsApp does not allow a free-form reply from BizzFlow. Use the phone app.";
