import { submitErrorCopy } from "@/lib/order-types";
import {
  describeOutcome,
  formatDuration,
  outcomeSubject,
  summarize,
  type OrderOutcome,
} from "./outcomes";

/**
 * The two emails this app sends.
 *
 * Plain, inline-styled HTML on the Stripe palette the dashboard uses. No React
 * Email, no external stylesheet: mail clients strip <style> blocks and none of
 * them fetch anything, so inline attributes are the only styling that survives.
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

const ordersUrl = (): string | null => {
  const base = appBaseUrl();
  return base ? `${base}/dashboard/order-entry?tab=drafts` : null;
};

function shell(title: string, body: string): string {
  const link = ordersUrl();
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:${SURFACE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;color:${INK};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};border-radius:12px;">
    <tr><td style="padding:24px 24px 8px;">
      <div style="font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${BRAND};">BizzFlow</div>
      <h1 style="margin:8px 0 0;font-size:18px;font-weight:600;line-height:1.3;color:${INK};">${title}</h1>
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

/**
 * The result of ONE submit.
 *
 * A failure carries the portal's own sentence verbatim (via `submitErrorCopy`
 * for the title and remedy) rather than a paraphrase — that sentence is what an
 * agent quotes to Unifi support, and rewording it makes it unquotable.
 */
export function singleResultEmail(o: OrderOutcome): { subject: string; html: string } {
  const { label, detail } = describeOutcome(o);
  const copy = submitErrorCopy(o.errorCode);
  const facts = [
    row("Customer", esc(o.fullName)),
    o.reference ? row("Reference", esc(o.reference)) : "",
    row("Outcome", esc(label)),
    o.portalOrderNo ? row("Portal order no.", esc(o.portalOrderNo)) : "",
  ].join("");

  const problem =
    copy || o.errorMessage
      ? `<div style="margin-top:16px;padding:12px 14px;background:${SURFACE};border:1px solid ${LINE};border-radius:8px;">
           ${copy ? `<div style="font-size:13px;font-weight:600;color:${INK};">${esc(copy.title)}</div>` : ""}
           ${o.errorMessage ? `<div style="margin-top:4px;font-size:13px;color:${INK};">${esc(o.errorMessage)}</div>` : ""}
           ${copy ? `<div style="margin-top:8px;font-size:13px;color:${MUTED};">${esc(copy.fix)}</div>` : ""}
         </div>`
      : "";

  return {
    subject: outcomeSubject(o, o.fullName),
    html: shell(
      label,
      `<p style="margin:0 0 14px;color:${MUTED};">${esc(detail)}</p>
       <table role="presentation" cellpadding="0" cellspacing="0">${facts}</table>
       ${problem}`,
    ),
  };
}

/**
 * ONE email for a whole batch — never one per order inside it.
 *
 * A ten-order batch that emailed per order would train the reader to ignore the
 * lot, which loses the two rows that actually need someone in the portal. So the
 * per-order results are rows in this table, in the order they ran.
 */
export function batchSummaryEmail(batch: {
  results: OrderOutcome[];
  startedAt: Date;
  finishedAt: Date;
}): { subject: string; html: string } {
  const t = summarize(batch.results);
  const base = appBaseUrl();

  const rows = batch.results
    .map((r, i) => {
      const { label } = describeOutcome(r);
      const right = r.portalOrderNo
        ? esc(r.portalOrderNo)
        : esc(submitErrorCopy(r.errorCode)?.title ?? r.errorMessage ?? "—");
      return `<tr>
        <td style="padding:8px 8px 8px 0;font-size:13px;color:${MUTED};vertical-align:top;">${i + 1}</td>
        <td style="padding:8px 8px 8px 0;font-size:13px;color:${INK};vertical-align:top;">
          <div style="font-weight:600;">${esc(r.fullName)}</div>
          ${r.reference ? `<div style="color:${MUTED};font-size:12px;">${esc(r.reference)}</div>` : ""}
        </td>
        <td style="padding:8px 8px 8px 0;font-size:13px;color:${INK};vertical-align:top;white-space:nowrap;">${esc(label)}</td>
        <td style="padding:8px 0;font-size:13px;color:${MUTED};vertical-align:top;">${right}</td>
      </tr>`;
    })
    .join("");

  // Named in full rather than as "2 issues": the whole point of the summary is
  // that the reader can tell, without opening the app, whether anyone has to go
  // into the Unifi portal today.
  const totals = [
    `${t.submitted} submitted`,
    `${t.orderEntered} order entered`,
    `${t.failed} failed`,
  ].join(" · ");

  const needsAttention = t.orderEntered > 0
    ? `<p style="margin:14px 0 0;padding:12px 14px;background:#FEF6E7;border:1px solid #F5D9A8;border-radius:8px;font-size:13px;color:${INK};">
         ${t.orderEntered} order${t.orderEntered === 1 ? "" : "s"} reached the Unifi portal without finishing. Each one exists there and needs to be resubmitted or voided by hand${base ? "" : ""}.
       </p>`
    : "";

  return {
    subject: `Batch submit finished: ${t.submitted}/${t.total} submitted`,
    html: shell(
      `Batch finished — ${totals}`,
      `<table role="presentation" cellpadding="0" cellspacing="0">
         ${row("Orders", String(t.total))}
         ${row("Started", esc(batch.startedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC"))}
         ${row("Finished", esc(batch.finishedAt.toISOString().replace("T", " ").slice(0, 19) + " UTC"))}
         ${row("Duration", esc(formatDuration(batch.finishedAt.getTime() - batch.startedAt.getTime())))}
       </table>
       ${needsAttention}
       <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:18px;border-top:1px solid ${LINE};">
         ${rows}
       </table>`,
    ),
  };
}
