import { describe, it, expect } from "vitest";
import { directorDisplay, directorIdNumber, isMyKad } from "../director-id";
import { resolveBizLetterFields } from "../bill-generator/biz-authorization-letter";

// Real shapes from one account's business cases (2026-09-19): 35 NRIC, 5
// passport, and 12 of 40 whose "National ID No." equals the company reg.
const CASES = [
  { director_name: "LEE KEE BENG", id_no: "070216070387", id_type: "mykad", company_reg: "PG0568772-H" },
  { director_name: "RAHIMAH BINTI HABEEB RAHMAN", id_no: "JR0191646W", id_type: "passport", company_reg: "JR0191646-W" },
  { director_name: "LOI TEE ZHEE", id_no: "960808086675", id_type: "mykad", company_reg: "960808086675" },
  { director_name: "NAEEM ULLAH", id_no: "QC9994653", id_type: "passport", company_reg: "" },
  { director_name: "", id_no: "070216070387", id_type: "mykad", company_reg: "X" },
];

describe("isMyKad", () => {
  it("accepts 12 digits that start with a real date, dashed or not", () => {
    expect(isMyKad("940811034224")).toBe(true);
    expect(isMyKad("940811-03-4224")).toBe(true);
  });
  it("refuses a BRN, a short number, letters, and an impossible month or day", () => {
    for (const v of ["1683594-U", "12345", "94081103422A", "941311034224", "940800034224"]) {
      expect(isMyKad(v)).toBe(false);
    }
  });
});

describe("directorIdNumber", () => {
  it("prints the ID as the case holds it, dashing only a real MyKad", () => {
    expect(directorIdNumber({ id_no: "940811034224" })).toBe("940811-03-4224");
    expect(directorIdNumber({ id_no: "JR0191646W" })).toBe("JR0191646W");
    expect(directorIdNumber({ id_no: "202301024655" })).toBe("202301024655");
    expect(directorIdNumber({ id_no: " qc9994653 " })).toBe("QC9994653");
    expect(directorIdNumber({ id_no: null })).toBe("");
  });
});

describe("directorDisplay — what the Case List shows", () => {
  it("shows the ID on file whatever it is, name or no name", () => {
    expect(CASES.map(directorDisplay)).toEqual([
      { name: "LEE KEE BENG", id: "070216-07-0387" },
      { name: "RAHIMAH BINTI HABEEB RAHMAN", id: "JR0191646W" },
      { name: "LOI TEE ZHEE", id: "960808-08-6675" },
      { name: "NAEEM ULLAH", id: "QC9994653" },
      { name: "", id: "070216-07-0387" },
    ]);
  });

  // The whole reason it exists: the screen must never promise a value the
  // letter will leave blank, or print one the screen hid. A missing name is the
  // screen's dash and the letter's `-`.
  it("matches the Biz Auth Letter's director block on every real shape", () => {
    for (const c of CASES) {
      const shown = directorDisplay(c);
      const printed = resolveBizLetterFields(c);
      expect(shown.name || "-").toBe(printed.directorName);
      expect(shown.id).toBe(printed.directorIc);
    }
  });
});
