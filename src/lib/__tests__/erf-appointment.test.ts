import { describe, it, expect } from "vitest";
import {
  installationParts,
  pdfTextLiterals,
  readAppointmentFromContent,
} from "@/lib/erf-appointment";

/**
 * The content-stream shape below is copied from a REAL e-RF (order
 * 2608000121625616, paid 2026-08-19) with the customer's details removed. Each
 * field is two `Tj` literals — label, then value — separated by the positioning
 * operators the portal emits between them.
 *
 * Real PDFs are deliberately NOT committed as fixtures: an e-RF carries a named
 * customer's address, phone number and account number, and a test fixture is
 * the last place that should live.
 */
const STREAM = String.raw`
1 0 0 1 0 0 cm
BT
1 0 0 1 20 503.04 Tm
/F1 10 Tf
(State)Tj
0 g
ET
BT
1 0 0 1 220 503.04 Tm
(SELANGOR)Tj
ET
BT
1 0 0 1 20 488.04 Tm
/F1 10 Tf
2 Tr
0.33333 w
(Installation Appointment Date)Tj
0 g
0 Tr
0 G
1 w
ET
1 0 0 1 0 0 cm
BT
1 0 0 1 220 488.04 Tm
/F1 10 Tf
0 0 0 rg
(2026-08-20 09:30-12:00)Tj
0 g
ET
BT
1 0 0 1 20 473.04 Tm
(Installation Contact Name)Tj
ET
`;

describe("pdfTextLiterals", () => {
  it("reads the drawn strings in order, ignoring the operators between them", () => {
    expect(pdfTextLiterals(STREAM)).toEqual([
      "State",
      "SELANGOR",
      "Installation Appointment Date",
      "2026-08-20 09:30-12:00",
      "Installation Contact Name",
    ]);
  });

  it("does not let a bracket inside a literal end the scan early", () => {
    // Real e-RFs print bracketed values: "Premium Value Samsung TV 65inch 1
    // (RM40)". An unescaped-aware scan stops at the inner ')' and every field
    // after it shifts by one — which would report the WRONG value as the
    // appointment rather than reporting nothing.
    const s = String.raw`(Device \(RM40\))Tj (Installation Appointment Date)Tj (2026-08-20 09:30-12:00)Tj`;
    expect(pdfTextLiterals(s)).toEqual([
      "Device (RM40)",
      "Installation Appointment Date",
      "2026-08-20 09:30-12:00",
    ]);
  });
});

describe("readAppointmentFromContent", () => {
  it("takes the value drawn after the label", () => {
    expect(readAppointmentFromContent(STREAM)).toBe("2026-08-20 09:30-12:00");
  });

  it("reads the pdftotext layout too", () => {
    // The form a human sees when they check the document by hand.
    const text = [
      "Installation Type               : APPOINTMENT",
      "Installation Appointment Date   : 2026-08-21 17:00-19:30",
      "Installation Contact Name       : SOME NAME",
    ].join("\n");
    expect(readAppointmentFromContent(text)).toBe("2026-08-21 17:00-19:30");
  });

  it("accepts a date with no window", () => {
    expect(readAppointmentFromContent("(Installation Appointment Date)Tj (2026-09-01)Tj"))
      .toBe("2026-09-01");
  });

  it("returns null when the document prints no appointment line", () => {
    // A self-install e-RF. Null is the correct answer, not a failure: the order
    // genuinely has no appointment, and the column shows a dash.
    const s = "(Installation Type)Tj (SELF INSTALL)Tj (Installation Contact Name)Tj (X)Tj";
    expect(readAppointmentFromContent(s)).toBeNull();
  });

  it("refuses a neighbouring label rather than reporting it as a date", () => {
    // The guard that matters: if the portal ever reorders these fields, the
    // literal after the label is somebody else's text. Reporting it would put a
    // confident, wrong installation date in front of an agent — strictly worse
    // than the dash that a null produces.
    const s = "(Installation Appointment Date)Tj (Installation Contact Name)Tj (LEE)Tj";
    expect(readAppointmentFromContent(s)).toBeNull();
  });

  it("collapses the layout's whitespace without touching the value", () => {
    expect(readAppointmentFromContent("(Installation Appointment Date)Tj (2026-08-20   09:30 - 12:00)Tj"))
      .toBe("2026-08-20 09:30-12:00");
  });
});

describe("installationParts", () => {
  it("splits into a DD-MM-YYYY date and its window", () => {
    expect(installationParts("2026-08-20 09:30-12:00")).toEqual({
      date: "20-08-2026",
      time: "09:30-12:00",
    });
  });

  it("handles a date with no window", () => {
    expect(installationParts("2026-09-01")).toEqual({ date: "01-09-2026", time: null });
  });

  it("shows an unexpected format rather than hiding it", () => {
    expect(installationParts("TBC")).toEqual({ date: "TBC", time: null });
  });

  it("is null for nothing at all", () => {
    expect(installationParts(null)).toBeNull();
    expect(installationParts("   ")).toBeNull();
  });
});
