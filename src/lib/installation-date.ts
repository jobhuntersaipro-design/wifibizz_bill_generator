import { prisma } from "@/lib/prisma";
import { getBytesFromR2 } from "@/lib/r2";
import { parseInstallationAppointment } from "@/lib/erf-appointment";

/**
 * Filling in the installation appointment for orders that already completed.
 *
 * The appointment is printed only on the e-RF, and BizzFlow keeps nothing else:
 * the scraper picks the slot and discards it, so for every order placed before
 * this existed the PDF in R2 is the sole record. That rules out "record it at
 * submit time" as the whole answer — those orders would stay blank forever —
 * and rules out parsing on every render, which would re-download a 110KB PDF
 * per completed order per page load.
 *
 * So: read the document once, keep the value, and never look again. Two columns
 * carry that — `installationDate` for the value and `installationCheckedAt` for
 * the fact that we looked — because an e-RF with no appointment line (a
 * self-install) is a real answer, and with only the value column it would be
 * indistinguishable from "not yet read" and re-fetched on every load.
 *
 * A future run gets this for free: the order becomes `submitted`, someone opens
 * the list, and the fill runs once.
 */

interface FillableOrder {
  id: string;
  userId: string;
  orderId: string | null;
  status: string;
  installationDate: string | null;
  installationCheckedAt: Date | null;
}

/**
 * The R2 key of one order's e-RF.
 *
 * Derived, not looked up. The scraper builds this key from the same three parts
 * (`r2_upload.erf_key`), so there is nothing to read back — and the alternative,
 * digging the key out of the run's `capture_erf` status event, only works for
 * orders whose event trail is still intact.
 *
 * The sanitising mirrors the scraper's: the order number reaches a key and a
 * URL, so anything outside [A-Za-z0-9] is stripped rather than escaped.
 */
export function erfKey(userId: string, orderRowId: string, portalOrderNo: string): string {
  const safe = portalOrderNo.replace(/[^A-Za-z0-9]+/g, "").slice(0, 32) || "order";
  return `order-screenshots/${userId}/${orderRowId}/${safe}_erf.pdf`;
}

/**
 * Which orders are worth reading an e-RF for.
 *
 * Only `submitted`: that status means the run went through Pay AND came back
 * with an e-RF — it is decided on `erf_key` in the first place — so it is
 * exactly the set of orders that has a document to read. An `order_entered` or
 * `warning` row stopped before Pay and has no e-RF at all, and probing R2 for
 * one would be a guaranteed miss on every load.
 */
export function needsInstallationDate(o: FillableOrder): boolean {
  return o.status === "submitted" && !!o.orderId && !o.installationCheckedAt;
}

/**
 * Read the e-RF for every order that has not been read yet and persist what it
 * says. Returns id → appointment for the orders that were filled this run.
 *
 * Best-effort throughout, and deliberately so: this is a decoration on a list
 * whose job is to show the agent their orders. R2 being unreachable, or one
 * document being unreadable, must cost a column — never the page. Each order is
 * isolated, so one bad PDF does not stop the others.
 */
export async function fillMissingInstallationDates(
  orders: FillableOrder[],
): Promise<Record<string, string | null>> {
  const pending = orders.filter(needsInstallationDate);
  if (pending.length === 0) return {};

  const filled: Record<string, string | null> = {};

  await Promise.all(
    pending.map(async (o) => {
      try {
        const pdf = await getBytesFromR2(erfKey(o.userId, o.id, o.orderId!));
        // Absent document, and that is final rather than early: `submitted` is
        // decided ON `erf_key` in the first place, so a run that had not
        // uploaded its e-RF would not be `submitted` yet. What lands here is an
        // order placed before captures existed at all, and it is marked checked
        // like any other — otherwise every one of them re-probes R2 on every
        // page load, forever. (A transient R2 failure cannot reach this line:
        // `getBytesFromR2` returns null only for a key that is genuinely not
        // there and throws for everything else, into the catch below.)
        const value = pdf ? parseInstallationAppointment(pdf) : null;
        await prisma.order.update({
          where: { id: o.id },
          data: { installationDate: value, installationCheckedAt: new Date() },
        });
        filled[o.id] = value;
      } catch (e) {
        console.error(`[installationDate] ${o.id}: read failed (skipping):`, e);
      }
    }),
  );

  return filled;
}
