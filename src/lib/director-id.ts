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

const alnum = (v: string | null | undefined): string =>
  present(v).replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/** A real MyKad: 12 digits whose first six are a calendar date (YYMMDD). */
export function isMyKad(value: string | null | undefined): boolean {
  const d = present(value).replace(/\D/g, "");
  if (d.length !== 12 || d.length !== present(value).replace(/[\s-]/g, "").length) return false;
  const mm = Number(d.slice(2, 4));
  const dd = Number(d.slice(4, 6));
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

/**
 * The director's IC / passport number, or '' when the portal does not really
 * have one.
 *
 * The portal's National ID No. is the only ID on the Customer tab, so it is the
 * director's — but agents often type the COMPANY registration number into it
 * (30% of one account's business cases). Equality with the company reg cannot
 * decide it on its own, because it is wrong both ways: case 202655047 holds its
 * BRN `JR0191646W` there (not an ID), while 202673021 holds the owner's genuine
 * IC `960808086675` in BOTH fields (the agent put the IC into the reg field).
 * So the TYPE and the SHAPE decide:
 *
 * 1. NRIC type and a real MyKad → the IC.
 * 2. Passport type and different from the company reg → a real passport.
 * 3. Anything else → blank. Printing a registration number on an IC line is
 *    worse than a line the director can fill in by hand.
 */
export function directorIdNumber(s: {
  id_no?: string | null;
  id_type?: string | null;
  company_reg?: string | null;
}): string {
  const id = present(s.id_no);
  if (!id) return "";
  const type = present(s.id_type).toLowerCase();

  if (/nric|mykad|ic\b/.test(type) && isMyKad(id)) return id.replace(/\D/g, "");
  if (/passport/.test(type)) {
    const reg = alnum(s.company_reg);
    if (reg && alnum(id) === reg) return "";
    return id.toUpperCase();
  }
  return "";
}

/**
 * The director as the screen shows it: name, and the ID only when there is a
 * name — an ID number under no name identifies nobody. Same rule as
 * `resolveBizDirector`, minus the PDF-font sanitising the letter needs.
 */
export function directorDisplay(s: {
  director_name?: string | null;
  id_no?: string | null;
  id_type?: string | null;
  company_reg?: string | null;
}): { name: string; id: string } {
  const name = realText(s.director_name);
  if (!name) return { name: "", id: "" };
  const id = directorIdNumber(s);
  // A MyKad prints dashed, the way the letter prints it.
  return { name, id: /^\d{12}$/.test(id) ? `${id.slice(0, 6)}-${id.slice(6, 8)}-${id.slice(8)}` : id };
}
