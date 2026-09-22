import { actionFor } from "@/lib/failure-action";
import { submitErrorCopy } from "@/lib/order-types";
import {
  batchBucket,
  batchSubject,
  bucketOf,
  describeOutcome,
  formatDuration,
  maskIdNumber,
  outcomeSubject,
  OUTCOME_MARK,
  shortErrorMessage,
  summarize,
  type OrderCaseDetails,
  type OrderOutcome,
  type OutcomeBucket,
} from "./outcomes";

/**
 * The two emails this app sends.
 *
 * Plain, inline-styled HTML on the Stripe palette the dashboard uses. No React
 * Email, no external stylesheet: mail clients strip <style> blocks and none of
 * them fetch anything, so inline attributes are the only styling that survives.
 * Layout is `<table>` for the same reason — flex and grid are unreliable in
 * Outlook, and a broken layout in a mail client is not something a reader can
 * work around.
 *
 * These functions are pure — they take values and return `{ subject, html }` —
 * so the wording and the aggregation can be tested without sending anything.
 */

const INK = "#0A2540";
const MUTED = "#697386";
const LINE = "#E3E8EF";
const BRAND = "#635BFF";
const SURFACE = "#F6F9FC";

/**
 * Escape text before it goes into the HTML.
 *
 * Customer names, portal error messages and addresses are all arbitrary input.
 * An unescaped `&` or `<` in a name doesn't just render oddly — it can truncate
 * the rest of the email at that character, so the reader silently loses the
 * results below it.
 */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The app's public base URL, for "open this order" links.
 *
 * Returns null when it can't be determined, and every caller then omits the
 * link rather than emitting a relative or half-built href — a link that 404s
 * from an email is worse than a plain reference number the reader can search.
 */
export function appBaseUrl(): string | null {
  const explicit = process.env.BIZZFLOW_APP_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

/**
 * A failure's "fix it" link: the draft, opened on the card that needs changing.
 *
 * Only for fix_field — a resubmit or a portal check from an e-mail would be a
 * link to the Orders page, which the mail already carries. The reader will
 * usually be on a phone with no session, so this lands on sign-in first and
 * then the draft; that was judged acceptable (user, 2026-08-31).
 */
const fixDraftUrl = (o: Pick<OrderOutcome, "orderId" | "errorCode" | "status" | "portalOrderNo">): string | null => {
  const base = appBaseUrl();
  if (!base) return null;
  const r = actionFor({ errorCode: o.errorCode, status: o.status, orderId: o.portalOrderNo });
  if (r.action !== "fix_field") return null;
  return `${base}/dashboard/order-entry/new-order?draft=${encodeURIComponent(o.orderId)}&focus=${r.section ?? "customer"}`;
};

const ordersUrl = (): string | null => {
  const base = appBaseUrl();
  return base ? `${base}/dashboard/order-entry?tab=drafts` : null;
};

/**
 * The admin view of one order — captures, the per-attempt timeline, every agent.
 *
 * Deliberately the ADMIN route and not `/order-entry/orders/<id>`: this link only
 * ever goes to the admin alert, whose reader is not the order's owner, and
 * `getOrderDetail` scopes the agent route to the owner (or a superadmin), so that
 * one answers "Order not found" for the very person the alert was sent to.
 */
const adminOrderUrl = (orderId: string): string | null => {
  const base = appBaseUrl();
  return base ? `${base}/admin/orders/${encodeURIComponent(orderId)}` : null;
};

/** Pill colours per outcome — the one visual carrying the whole verdict. */
const PILL: Record<OutcomeBucket, { fg: string; bg: string; border: string }> = {
  submitted: { fg: "#0F7B4F", bg: "#E7F6EE", border: "#B7E3CC" },
  failed: { fg: "#B4232C", bg: "#FDECEE", border: "#F5C2C7" },
};

function pill(bucket: OutcomeBucket, label: string): string {
  const c = PILL[bucket];
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${c.bg};border:1px solid ${c.border};color:${c.fg};font-size:12px;font-weight:600;line-height:1.5;white-space:nowrap;">${esc(label)}</span>`;
}

/**
 * The card the email is built in.
 *
 * `mark` is the tick or the cross, and it leads the heading as well as the
 * subject: a subject line is gone the moment the mail is open, and the verdict
 * has to survive that.
 */
function shell(mark: string, title: string, body: string): string {
  const link = ordersUrl();
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:24px;background:${SURFACE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:${INK};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};border-radius:12px;">
    <tr><td style="padding:24px 24px 8px;">
      <div style="font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND};">BizzFlow</div>
      <h1 style="margin:8px 0 0;font-size:18px;font-weight:600;line-height:1.3;color:${INK};"><span style="margin-right:6px;">${mark}</span>${title}</h1>
    </td></tr>
    <tr><td style="padding:8px 24px 24px;font-size:14px;line-height:1.55;color:${INK};">${body}</td></tr>
    <tr><td style="padding:16px 24px;border-top:1px solid ${LINE};font-size:12px;color:${MUTED};">
      ${link ? `<a href="${esc(link)}" style="color:${BRAND};text-decoration:none;font-weight:600;">Open the Orders page</a><br/>` : ""}
      You're getting this because order notifications are on for your BizzFlow account. Change the destination address in Settings.
    </td></tr>
  </table>
</body></html>`;
}

/** A label/value row, for the fact lists in both emails. */
function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top;">${esc(label)}</td>
    <td style="padding:6px 0;font-size:13px;font-weight:600;color:${INK};">${value}</td>
  </tr>`;
}

/** A section heading inside the card. */
function heading(text: string): string {
  return `<div style="margin:20px 0 6px;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${esc(text)}</div>`;
}

/**
 * The case details, as label/value rows.
 *
 * A field with no value is OMITTED, not dashed. These blocks are also rendered
 * for runs recorded before the details existed, and a column of dashes there
 * would read as "this order has no package and no address" — a claim about the
 * order rather than about what the run recorded.
 *
 * The ID is masked. Email is not a private channel: it is forwarded, indexed and
 * kept, and the last four digits are all a reader needs to tell two customers
 * apart. The full number stays in the app behind a login.
 */
function detailRows(d: OrderCaseDetails | undefined, opts: { address?: boolean } = {}): string {
  if (!d) return "";
  const parts: string[] = [];
  const id = maskIdNumber(d.idNumber);
  if (id) parts.push(row(d.idType || "ID", esc(id)));
  if (d.mobile) parts.push(row("Phone", esc(d.mobile)));
  if (d.email) parts.push(row("Email", esc(d.email)));
  if (opts.address !== false && d.address) parts.push(row("Address", esc(d.address)));
  if (d.offerName) parts.push(row("Package", esc(d.offerName)));
  if (d.deviceName) parts.push(row("Device", esc(d.deviceName)));
  if (d.installationDate) parts.push(row("Installation", esc(d.installationDate)));
  return parts.join("");
}

/**
 * The failure box: the portal's own sentence, verbatim.
 *
 * `submitErrorCopy` supplies the title and the remedy for a classified code and
 * nothing for an unclassified one, in which case the raw message still shows —
 * an unmapped failure must never produce an empty box, which reads as "no
 * reason given" when the reason was right there.
 */
function problemBox(
  o: Pick<OrderOutcome, "errorCode" | "errorMessage" | "tries" | "orderId" | "status" | "portalOrderNo">,
): string {
  const fix = fixDraftUrl(o);
  const copy = submitErrorCopy(o.errorCode);
  const message = shortErrorMessage(o.errorMessage);
  if (!copy && !message) return "";
  // Said only when it happened. `tries` is absent on results frozen before
  // retries existed, and "1 try" on a single run is noise — a reader learns
  // nothing from being told the obvious.
  const tries =
    o.tries && o.tries > 1
      ? `<div style="margin-top:8px;font-size:13px;color:${MUTED};">Tried ${o.tries} times automatically before giving up.</div>`
      : "";
  return `<div style="margin-top:12px;padding:12px 14px;background:${SURFACE};border:1px solid ${LINE};border-radius:8px;">
      ${copy ? `<div style="font-size:13px;font-weight:600;color:${INK};">${esc(copy.title)}</div>` : ""}
      ${message ? `<div style="margin-top:4px;font-size:13px;line-height:1.5;color:${INK};word-break:break-word;">${esc(message)}</div>` : ""}
      ${copy ? `<div style="margin-top:8px;font-size:13px;color:${MUTED};">${esc(copy.fix)}</div>` : ""}
      ${fix ? `<div style="margin-top:10px;"><a href="${esc(fix)}" style="display:inline-block;padding:8px 14px;background:${BRAND};color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">Fix the draft</a></div>` : ""}
      ${tries}
    </div>`;
}

/**
 * The result of ONE submit.
 *
 * A failure carries the portal's own sentence verbatim (via `submitErrorCopy`
 * for the title and remedy) rather than a paraphrase — that sentence is what an
 * agent quotes to Unifi support, and rewording it makes it unquotable.
 */
export function singleResultEmail(
  o: OrderOutcome,
  /**
   * `adminLink` adds an "Open in admin" button. Off by default so the agent's
   * own email is unchanged — that page is behind the separate admin JWT, and
   * offering an agent a door they cannot open is worse than no door.
   */
  opts: { adminLink?: boolean } = {},
): { subject: string; html: string } {
  const { label, detail } = describeOutcome(o);
  const bucket = bucketOf(o);
  const admin = opts.adminLink ? adminOrderUrl(o.orderId) : null;

  const orderFacts = [
    o.reference ? row("Reference", esc(o.reference)) : "",
    o.portalOrderNo ? row("Portal order no.", esc(o.portalOrderNo)) : "",
  ].join("");

  return {
    subject: outcomeSubject(o, o.fullName),
    html: shell(
      OUTCOME_MARK[bucket],
      esc(o.fullName),
      `<div style="margin:0 0 12px;">${pill(bucket, label)}</div>
       <p style="margin:0 0 14px;color:${MUTED};">${esc(detail)}</p>
       ${orderFacts ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${orderFacts}</table>` : ""}
       ${problemBox(o)}
       ${admin ? `<div style="margin-top:14px;"><a href="${esc(admin)}" style="display:inline-block;padding:9px 16px;background:${BRAND};color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">Open in admin</a></div>` : ""}
       ${detailRows(o.details) ? `${heading("Case details")}<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${detailRows(o.details)}</table>` : ""}`,
    ),
  };
}

/** One count in the summary's three-up totals strip. */
function tile(count: number, label: string, bucket: OutcomeBucket): string {
  const c = PILL[bucket];
  return `<td width="50%" style="padding:0 4px;">
    <div style="padding:12px 10px;background:${c.bg};border:1px solid ${c.border};border-radius:8px;text-align:center;">
      <div style="font-size:22px;font-weight:600;line-height:1.1;color:${c.fg};">${count}</div>
      <div style="margin-top:2px;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${c.fg};">${esc(label)}</div>
    </div>
  </td>`;
}

/**
 * ONE email for a whole batch — never one per order inside it.
 *
 * A ten-order batch that emailed per order would train the reader to ignore the
 * lot, which loses the two rows that actually need someone in the portal. So the
 * per-order results are cards in this email, in the order they ran.
 *
 * Cards rather than table rows because the details are what make a row
 * actionable — the reader can tell WHICH customer stranded, on which package, at
 * which address, without opening the app. A four-column table cannot hold that
 * without wrapping into an unreadable mess on a phone.
 */
export function batchSummaryEmail(batch: {
  results: OrderOutcome[];
  startedAt: Date;
  finishedAt: Date;
}): { subject: string; html: string } {
  const t = summarize(batch.results);

  const cards = batch.results
    .map((r, i) => {
      const { label } = describeOutcome(r);
      const bucket = bucketOf(r);
      const details = detailRows(r.details);
      const failure = bucket === "failed" ? problemBox(r) : "";
      return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:12px;border:1px solid ${LINE};border-radius:8px;">
        <tr><td style="padding:12px 14px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size:14px;font-weight:600;color:${INK};vertical-align:top;">
                ${i + 1}. ${esc(r.fullName)}
                ${r.reference ? `<span style="margin-left:6px;font-size:12px;font-weight:400;color:${MUTED};">${esc(r.reference)}</span>` : ""}
              </td>
              <td align="right" style="vertical-align:top;">${pill(bucket, label)}</td>
            </tr>
          </table>
          ${r.portalOrderNo ? `<div style="margin-top:6px;font-size:13px;color:${INK};">Portal order no. <strong>${esc(r.portalOrderNo)}</strong></div>` : ""}
          ${details ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:6px;">${details}</table>` : ""}
          ${failure}
        </td></tr>
      </table>`;
    })
    .join("");

  // Named in full rather than as "1 issue": the reader can tell from the
  // heading alone whether this run left anything behind.
  const totals = `${t.submitted} submitted · ${t.failed} failed`;

  return {
    subject: batchSubject(t),
    html: shell(
      OUTCOME_MARK[batchBucket(t)],
      `Batch finished — ${totals}`,
      `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;">
         <tr>
           ${tile(t.submitted, "Submitted", "submitted")}
           ${tile(t.failed, "Failed", "failed")}
         </tr>
       </table>
       <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
         ${row("Orders", String(t.total))}
         ${row("Started", esc(batch.startedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC"))}
         ${row("Finished", esc(batch.finishedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC"))}
         ${row("Duration", esc(formatDuration(batch.finishedAt.getTime() - batch.startedAt.getTime())))}
       </table>
       ${heading("Orders in this batch")}
       ${cards}`,
    ),
  };
}

/**
 * The test email the Settings card sends.
 *
 * Deliberately built on the same `shell()` as the two real emails: a test that
 * rendered its own markup would prove Resend accepted a request and nothing
 * about whether an order result is readable when it lands. It carries the tick
 * for the same reason the others do — the verdict has to survive the subject
 * line being gone.
 */
export function testEmail(to: string): { subject: string; html: string } {
  const title = "Email setup successfully";
  return {
    subject: `${OUTCOME_MARK.submitted} ${title}`,
    html: shell(
      OUTCOME_MARK.submitted,
      title,
      `<p style="margin:0 0 12px;">Email setup successfully.</p>
       <p style="margin:0;color:${MUTED};">
         This is a test sent from Settings to <strong style="color:${INK};">${esc(to)}</strong>.
         Order results and batch summaries will arrive here.
       </p>`,
    ),
  };
}

/**
 * A minimal transactional mail for account flows (password reset). Reuses the
 * same visual shell as the order mails so the sender is recognisably the same
 * app, but takes plain strings — nothing order-shaped.
 */
export function accountEmailShell(
  title: string,
  body: string,
  cta: { label: string; url: string },
  footnote: string,
): string {
  return shell(
    "🔐",
    title,
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${INK};">${esc(body)}</p>
     <div style="margin:18px 0;">
       <a href="${esc(cta.url)}" style="display:inline-block;padding:10px 18px;background:${BRAND};color:#fff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">${esc(cta.label)}</a>
     </div>
     <p style="margin:0;font-size:12px;color:${MUTED};">${esc(footnote)}</p>`,
  );
}
