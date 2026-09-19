// The director's name and ID as WifiBizz records them — the rules only.
//
// Kept free of any import so the Case List can show exactly what the Biz Auth
// Letter and the Bizz Chat print without bundling the address parser and its
// postcode table into the browser. `biz-director.ts` builds on these.

const present = (v: string | null | undefined): string => (v ?? "").trim();

/**
 * The portal's own "nothing here" marker — agents leave a bare dash in the Name
 * field. The crawl already stores it as '', but a row read by an older build, or
 * a value typed on an order, may still carry it.
 */
export function realText(v: string | null | undefined): string {
  const t = present(v);
  return /^[-–—]+$/.test(t) ? "" : t;
}

/** A real MyKad: 12 digits whose first six are a calendar date (YYMMDD). */
export function isMyKad(value: string | null | undefined): boolean {
  const d = present(value).replace(/\D/g, "");
  if (d.length !== 12 || d.length !== present(value).replace(/[\s-]/g, "").length) return false;
  const mm = Number(d.slice(2, 4));
  const dd = Number(d.slice(4, 6));
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

/**
 * The director's IC / passport number, ready to print: the portal's National ID
 * No. as the case holds it (user, 2026-09-19 — WifiBizz data is generated, so
 * the letter prints its original data rather than second-guessing it).
 *
 * A real MyKad prints dashed. Anything else — a passport, or the company
 * registration number an agent typed there — prints as typed. The dash is
 * decided by `isMyKad`, not by length: a new-format SSM number is also 12 digits
 * and must not be dressed up as an IC.
 */
export function directorIdNumber(s: { id_no?: string | null }): string {
  const id = present(s.id_no);
  if (!isMyKad(id)) return id.toUpperCase();
  const d = id.replace(/\D/g, "");
  return `${d.slice(0, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

/**
 * The director as the screen shows it — the same values the Biz Auth Letter
 * prints, minus the PDF-font sanitising. The ID shows whether or not the portal
 * has a name; a missing name is left for the caller to render as its dash.
 */
export function directorDisplay(s: {
  director_name?: string | null;
  id_no?: string | null;
}): { name: string; id: string } {
  return { name: realText(s.director_name), id: directorIdNumber(s) };
}
