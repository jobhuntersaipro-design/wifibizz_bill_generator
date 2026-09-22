import { Resend } from "resend";

/**
 * The one place an email actually leaves this app.
 *
 * All sending lives on Vercel: the droplet never holds the Resend key and never
 * renders a template, it only reports that a run finished. That keeps the
 * secret and the templates in one codebase, and lets a send read customer names
 * out of Prisma, which the droplet cannot do.
 */

const FROM = process.env.NOTIFY_FROM_EMAIL ?? "";
const API_KEY = process.env.RESEND_API_KEY ?? "";

// Built lazily so importing this module never throws on a machine with no key —
// `npm run build` imports every route, and a constructor that demanded the key
// would fail the build rather than the send.
let client: Resend | null = null;
function resend(): Resend {
  if (!client) client = new Resend(API_KEY);
  return client;
}

export interface SendResult {
  sent: boolean;
  /** Why not, when `sent` is false. Logged, never shown to the recipient. */
  reason?: string;
}

/**
 * Send one email, and never throw.
 *
 * A notification is the LAST thing that happens after a submit, and it must not
 * be able to change the submit's outcome — a thrown send would fail the webhook
 * response and make the droplet redeliver an event that was already processed.
 * So every failure comes back as `{ sent: false }` with a logged reason.
 *
 * With no `RESEND_API_KEY` this no-ops with a warning, so local development
 * without mail credentials behaves exactly like production minus the delivery.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  /** Copied in, when set. One send, so the two readers cannot get two stories. */
  cc?: string;
}): Promise<SendResult> {
  if (!API_KEY || !FROM) {
    const missing = !API_KEY ? "RESEND_API_KEY" : "NOTIFY_FROM_EMAIL";
    console.warn(
      `[notifications] ${missing} is not set — not sending "${opts.subject}" to ${opts.to}.`,
    );
    return { sent: false, reason: `${missing} not configured` };
  }
  try {
    const { error } = await resend().emails.send({
      from: FROM,
      to: [opts.to],
      ...(opts.cc ? { cc: [opts.cc] } : {}),
      subject: opts.subject,
      html: opts.html,
    });
    // The SDK reports delivery failures in `error` rather than by throwing, so
    // a bare try/catch alone would report every rejected send as a success.
    if (error) {
      console.error("[notifications] Resend rejected the send:", error);
      return { sent: false, reason: error.message };
    }
    return { sent: true };
  } catch (e) {
    // Network-level failure — the SDK does throw for these.
    console.error("[notifications] send failed:", e);
    return { sent: false, reason: e instanceof Error ? e.message : "send failed" };
  }
}

/** Whether sending is configured at all. Used to word the UI honestly. */
export const notificationsConfigured = (): boolean => !!API_KEY && !!FROM;
