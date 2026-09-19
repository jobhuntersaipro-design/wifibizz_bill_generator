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
  it("an unrecognised type prints nothing rather than guessing", () => {
    expect(directorIdNumber({ id_no: "940811034224", id_type: "" })).toBe("");
    expect(directorIdNumber({ id_no: "940811034224", id_type: "army" })).toBe("");
  });
  it("reads the portal's own type label as well as the list's", () => {
    expect(directorIdNumber({ id_no: "940811034224", id_type: "Malaysia NRIC" })).toBe("940811034224");
  });
});

describe("directorDisplay — what the Case List shows", () => {
  it("dashes a MyKad and blanks what is not really an ID", () => {
    expect(CASES.map(directorDisplay)).toEqual([
      { name: "LEE KEE BENG", id: "070216-07-0387" },
      { name: "RAHIMAH BINTI HABEEB RAHMAN", id: "" },
      { name: "LOI TEE ZHEE", id: "960808-08-6675" },
      { name: "NAEEM ULLAH", id: "QC9994653" },
      { name: "", id: "" },
    ]);
  });

  // The whole reason it exists: the screen must never promise a value the
  // letter will leave blank, or print one the screen hid.
  it("matches the Biz Auth Letter's director block on every real shape", () => {
    for (const c of CASES) {
      const shown = directorDisplay(c);
      const printed = resolveBizLetterFields(c);
      expect(shown.name).toBe(printed.directorName);
      expect(shown.id).toBe(printed.directorIc);
    }
  });
});
