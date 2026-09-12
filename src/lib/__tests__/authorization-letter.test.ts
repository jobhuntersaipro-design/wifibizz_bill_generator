import { describe, it, expect, beforeAll } from "vitest";
import {
  generateOwner,
  formatIcDashed,
  icDigits,
  hashSeed,
  makeRng,
} from "@/lib/bill-generator/owner-identity";
import { createDocumentParties } from "@/lib/bill-generator/document-parties";
import {
  generateAuthorizationLetter,
  sanitize,
  wrapToWidth,
  packStreetLines,
  buildLetterAddress,
} from "@/lib/bill-generator/authorization-letter";
import {
  initialsOf,
  drawSignature,
  signaturePaths,
  FLOURISH_DESCENT,
  SIGNATURE_ASCENT,
} from "@/lib/bill-generator/signature";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import {
  ordinalDate,
  longDate,
  slashDate,
  effectiveDate,
} from "@/lib/bill-generator/letter-dates";

const CUSTOMER = "MUHAMMAD SAHINU BIN INSANU";

describe("seeded rng", () => {
  it("is stable for the same seed and differs across seeds", () => {
    const a = makeRng(hashSeed("owner:202624115"));
    const b = makeRng(hashSeed("owner:202624115"));
    const c = makeRng(hashSeed("owner:202624116"));
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c()]).not.toEqual(seqA);
  });
});

describe("generateOwner", () => {
  const now = new Date(2026, 7, 22);

  it("is an English given name plus a Chinese surname", () => {
    const owner = generateOwner("202624115", CUSTOMER, now);
    expect(owner.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("gives the same case the same owner every time", () => {
    const a = generateOwner("202624115", CUSTOMER, now);
    const b = generateOwner("202624115", CUSTOMER, now);
    expect(b).toEqual(a);
  });

  it("gives different cases different owners", () => {
    const names = new Set(
      Array.from({ length: 40 }, (_, i) => generateOwner(`2026241${i}`, CUSTOMER, now).name)
    );
    // Not a uniqueness guarantee — just that the pools are actually being spread.
    expect(names.size).toBeGreaterThan(20);
  });

  it("never lands on a surname the customer already carries", () => {
    // Every case number is checked against a customer named for each surname in turn.
    for (const surname of ["Lee", "Tan", "Lim", "Wong", "Ng"]) {
      for (let i = 0; i < 30; i++) {
        const owner = generateOwner(`case-${surname}-${i}`, `AH ${surname.toUpperCase()} SENG`, now);
        expect(owner.name.split(" ")[1].toLowerCase()).not.toBe(surname.toLowerCase());
      }
    }
  });

  it("produces a 12-digit IC whose birth date is real and whose age is 35-65", () => {
    for (let i = 0; i < 200; i++) {
      const { ic } = generateOwner(`case-${i}`, CUSTOMER, now);
      expect(ic).toMatch(/^\d{12}$/);

      const yy = Number(ic.slice(0, 2));
      const mm = Number(ic.slice(2, 4));
      const dd = Number(ic.slice(4, 6));
      const pb = Number(ic.slice(6, 8));

      expect(mm).toBeGreaterThanOrEqual(1);
      expect(mm).toBeLessThanOrEqual(12);
      expect(dd).toBeGreaterThanOrEqual(1);
      expect(dd).toBeLessThanOrEqual(28);
      expect(pb).toBeGreaterThanOrEqual(1);
      expect(pb).toBeLessThanOrEqual(16);

      const age = now.getFullYear() - (1900 + yy);
      expect(age).toBeGreaterThanOrEqual(35);
      expect(age).toBeLessThanOrEqual(65);
    }
  });

  it("agrees with itself on gender — the last IC digit's parity matches the name drawn", () => {
    for (let i = 0; i < 200; i++) {
      const owner = generateOwner(`case-${i}`, CUSTOMER, now);
      const odd = Number(owner.ic[11]) % 2 === 1;
      expect(odd).toBe(owner.gender === "male");
    }
  });
});

describe("IC formatting", () => {
  it("dashes a 12-digit number the way the signature block prints it", () => {
    expect(formatIcDashed("911225055166")).toBe("911225-05-5166");
  });

  it("re-dashes an already-dashed number rather than doubling the dashes", () => {
    expect(formatIcDashed("911225-05-5166")).toBe("911225-05-5166");
  });

  it("leaves anything that is not 12 digits alone", () => {
    expect(formatIcDashed("A12345")).toBe("A12345");
    expect(formatIcDashed("")).toBe("");
  });

  it("strips separators for the body sentence", () => {
    expect(icDigits("911225-05-5166")).toBe("911225055166");
  });
});

describe("date formatting", () => {
  it("renders the letter heading in ordinal form", () => {
    expect(ordinalDate(new Date(2026, 7, 22))).toBe("22nd AUGUST 2026");
    expect(ordinalDate(new Date(2025, 7, 10))).toBe("10th AUGUST 2025");
  });

  it("gets the awkward ordinals right", () => {
    const suffixes = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(
      (d) => ordinalDate(new Date(2026, 0, d)).split(" ")[0]
    );
    expect(suffixes).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st",
    ]);
  });

  it("renders the effective clause and the signature dates", () => {
    expect(longDate(new Date(2025, 7, 1))).toBe("1 AUGUST 2025");
    expect(slashDate(new Date(2025, 7, 10))).toBe("10/08/2025");
  });
});

describe("effectiveDate", () => {
  it("is never later than the letter date, on any day of any month", () => {
    for (let month = 0; month < 12; month++) {
      for (let day = 1; day <= 28; day++) {
        const letter = new Date(2026, month, day);
        for (let c = 0; c < 12; c++) {
          const eff = effectiveDate(`case-${c}`, letter);
          expect(eff.getTime()).toBeLessThanOrEqual(letter.getTime());
        }
      }
    }
  });

  it("stays in the letter's own month, days 1-10, once past the 10th", () => {
    const letter = new Date(2026, 7, 22);
    for (let c = 0; c < 50; c++) {
      const eff = effectiveDate(`case-${c}`, letter);
      expect(eff.getMonth()).toBe(7);
      expect(eff.getFullYear()).toBe(2026);
      expect(eff.getDate()).toBeGreaterThanOrEqual(1);
      expect(eff.getDate()).toBeLessThanOrEqual(10);
    }
  });

  it("clamps the window to the letter day between the 3rd and the 10th", () => {
    for (const day of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const letter = new Date(2026, 7, day);
      for (let c = 0; c < 50; c++) {
        const eff = effectiveDate(`case-${c}`, letter);
        expect(eff.getMonth()).toBe(7);
        expect(eff.getDate()).toBeLessThanOrEqual(day);
      }
    }
  });

  it("rolls back to the previous month on the 1st and 2nd", () => {
    for (const day of [1, 2]) {
      const letter = new Date(2026, 7, day);
      for (let c = 0; c < 50; c++) {
        const eff = effectiveDate(`case-${c}`, letter);
        expect(eff.getMonth()).toBe(6); // July
        expect(eff.getFullYear()).toBe(2026);
        expect(eff.getDate()).toBeGreaterThanOrEqual(1);
        expect(eff.getDate()).toBeLessThanOrEqual(10);
      }
    }
  });

  it("decrements the year when rolling back from January", () => {
    const letter = new Date(2026, 0, 1);
    for (let c = 0; c < 50; c++) {
      const eff = effectiveDate(`case-${c}`, letter);
      expect(eff.getMonth()).toBe(11); // December
      expect(eff.getFullYear()).toBe(2025);
    }
  });

  it("gives the same case the same effective date", () => {
    const letter = new Date(2026, 7, 22);
    expect(effectiveDate("202624115", letter).getTime()).toBe(
      effectiveDate("202624115", letter).getTime()
    );
  });
});

describe("sanitize", () => {
  it("maps the punctuation portal addresses actually carry to ASCII", () => {
    expect(sanitize("JALAN 1\u20132, D\u2019BOULEVARD")).toBe("JALAN 1-2, D'BOULEVARD");
  });

  it("drops what Latin-1 cannot encode, rather than letting pdf-lib throw", () => {
    expect(sanitize("TAMAN \u4e2d\u6587 JAYA")).toBe("TAMAN JAYA");
  });

  it("collapses whitespace runs left by blank address segments", () => {
    expect(sanitize("3 -   TAMAN   INDAH")).toBe("3 - TAMAN INDAH");
  });
});

describe("wrapToWidth", () => {
  let font: PDFFont;

  beforeAll(async () => {
    const doc = await PDFDocument.create();
    font = await doc.embedFont(StandardFonts.Helvetica);
  });

  it("keeps every line inside the measured width", () => {
    const text =
      "I hereby authorize MUHAMMAD SAHINU BIN INSANU with 970815125312 is the resident " +
      "at my premise located at 80, JALAN BESAR LUKUT, BATU 4, TAMAN LUKUT JAYA, " +
      "71010 LUKUT, NEGERI SEMBILAN, MALAYSIA. effective 7 AUGUST 2026.";
    for (const line of wrapToWidth(text, font, 11, 451.28)) {
      expect(font.widthOfTextAtSize(line, 11)).toBeLessThanOrEqual(451.28);
    }
  });

  it("measures rather than counts — a line of wide glyphs breaks sooner than a line of narrow ones", () => {
    const wide = wrapToWidth("W".repeat(40).split("").join(" "), font, 11, 200);
    const narrow = wrapToWidth("i".repeat(40).split("").join(" "), font, 11, 200);
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it("never drops a word, even one wider than the whole line", () => {
    const long = "A".repeat(200);
    expect(wrapToWidth(`start ${long} end`, font, 11, 100).join(" ")).toContain(long);
  });

  it("returns nothing for empty text", () => {
    expect(wrapToWidth("   ", font, 11, 451)).toEqual([]);
  });
});

describe("packStreetLines", () => {
  it("packs the street segments together and breaks at the housing area", () => {
    expect(
      packStreetLines(["80", "JALAN BESAR LUKUT", "BATU 4", "TAMAN LUKUT JAYA"])
    ).toEqual(["80, JALAN BESAR LUKUT, BATU 4", "TAMAN LUKUT JAYA"]);
  });

  it("does not strand a house number on a line of its own", () => {
    const lines = packStreetLines(["80", "JALAN BESAR LUKUT"]);
    expect(lines).toEqual(["80, JALAN BESAR LUKUT"]);
  });

  it("keeps a locality-led address on one line when it leads", () => {
    expect(packStreetLines(["TAMAN LUKUT JAYA"])).toEqual(["TAMAN LUKUT JAYA"]);
  });

  it("handles an empty address", () => {
    expect(packStreetLines([])).toEqual([]);
  });
});

describe("buildLetterAddress", () => {
  it("splits a landed address into letterhead lines and an inline form", async () => {
    const addr = await buildLetterAddress(
      "80, JALAN BESAR LUKUT, BATU 4, TAMAN LUKUT JAYA, 71010 LUKUT, NEGERI SEMBILAN",
      "LEE PEI LING"
    );
    expect(addr.block[0]).toBe("80, JALAN BESAR LUKUT, BATU 4");
    expect(addr.block).toContain("TAMAN LUKUT JAYA");
    expect(addr.block[addr.block.length - 1]).toBe("NEGERI SEMBILAN");
    expect(addr.inline).toContain("71010 LUKUT");
    expect(addr.inline).toContain("NEGERI SEMBILAN");
  });

  it("keeps a condo unit prefix, which the parsed components drop", async () => {
    const addr = await buildLetterAddress(
      "A-12-3, CYBERSQUARE TOWER 1, JALAN TEKNOKRAT 5, 63000 CYBERJAYA, SELANGOR",
      "LEE PEI LING"
    );
    expect(addr.block[0]).toContain("A-12-3");
    expect(addr.inline).toContain("A-12-3");
  });

  // These three are the shapes the WifiBizz portal actually stores: no commas at
  // all, the postcode LAST, and dashes standing in for blank segments. Every one
  // of them broke a version of this code that synthetic addresses had passed.
  it("does not repeat the city, state and country it already stripped", async () => {
    const addr = await buildLetterAddress(
      "A-2-2 LORONG MALAWA COURT 2 BLOCK A MALAWA COURT KOTA KINABALU SABAH MALAYSIA 88450",
      "NAZURAH AFRINA BINTI ALIAKBAR"
    );
    expect(addr.block[0]).toBe("A-2-2 LORONG MALAWA COURT 2 BLOCK A MALAWA COURT");
    expect(addr.block).toEqual(["A-2-2 LORONG MALAWA COURT 2 BLOCK A MALAWA COURT", "88450 KOTA KINABALU", "SABAH"]);
    expect(addr.inline).not.toMatch(/SABAH[\s\S]*SABAH/);
  });

  it("takes the city from the postcode, not the parser that returned 'KINABALU'", async () => {
    const addr = await buildLetterAddress(
      "A-2-2 LORONG MALAWA COURT KOTA KINABALU SABAH MALAYSIA 88450",
      "SOMEONE"
    );
    expect(addr.block).toContain("88450 KOTA KINABALU");
    // The stranded half of the city name must not survive on the street line.
    expect(addr.block[0]).not.toMatch(/\bKOTA$/);
  });

  it("drops the dashes the portal leaves where a segment was blank", async () => {
    const addr = await buildLetterAddress(
      "12 JALAN MIRI BYPASS - - KAMPUNG PADANG KERBAU MIRI SARAWAK MALAYSIA 98000",
      "NOOR AZIEZAH BINTI ISMAIL"
    );
    expect(addr.block[0]).toBe("12 JALAN MIRI BYPASS KAMPUNG PADANG KERBAU");
    expect(addr.inline).not.toContain(" - ");
  });

  it("keeps the address's own city when the postcode table merely names a different one", async () => {
    // 71010 is PORT DICKSON in the table and LUKUT in the address. The letter
    // should say what the customer's address says.
    const addr = await buildLetterAddress(
      "80, JALAN BESAR LUKUT, BATU 4, TAMAN LUKUT JAYA, 71010 LUKUT, NEGERI SEMBILAN",
      "SOMEONE"
    );
    expect(addr.inline).toContain("71010 LUKUT");
    expect(addr.inline).not.toContain("PORT DICKSON");
  });

  it("returns nothing for a blank address rather than throwing", async () => {
    expect(await buildLetterAddress("", "LEE PEI LING")).toEqual({ block: [], inline: "" });
  });
});

async function letterVisibleText(bytes: Uint8Array): Promise<string> {
  const { extractTextRuns, loadPageCmaps } = await import("@/lib/bill-generator/tenancy-stamp");
  const { getPageStreamRefs, transformStream } = await import("@/lib/bill-generator/pdf-utils");
  const doc = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const page of doc.getPages()) {
    const cmaps = loadPageCmaps(doc, page);
    for (const entry of getPageStreamRefs(doc, page)) {
      transformStream(doc, entry, (buf) => {
        for (const run of extractTextRuns(buf.toString("latin1"), cmaps)) {
          if (run.text.trim()) parts.push(run.text);
        }
        return { data: buf, count: 0 };
      });
    }
  }
  return parts.join("\n");
}

describe("the whole letter", () => {
  const CASE = {
    case_no: "202662528",
    full_name: "NAZURAH AFRINA BINTI ALIAKBAR",
    id_no: "011023120384",
    full_address: "A-2-2 LORONG MALAWA COURT 2 BLOCK A MALAWA COURT KOTA KINABALU SABAH MALAYSIA 88450",
  };

  it("produces a one-page PDF", async () => {
    const bytes = await generateAuthorizationLetter(CASE, new Date(2026, 7, 22));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("prints a portal-escaped customer name with a real apostrophe", async () => {
    const when = new Date(2026, 7, 22);
    const bytes = await generateAuthorizationLetter(
      { ...CASE, full_name: "SITI AYESAH BINTI YA&#039;ASAK" },
      when,
      { parties: createDocumentParties(when, makeRng(3), "SITI AYESAH BINTI YA'ASAK") },
    );
    const text = await letterVisibleText(bytes);
    expect(text).toContain("SITI AYESAH BINTI YA'ASAK");
    expect(text).not.toContain("&#039;");
  });

  it("prints the same landlord when both letters share one generate's parties", async () => {
    const when = new Date(2026, 7, 22);
    const parties = createDocumentParties(when, makeRng(11), CASE.full_name);
    const a = await generateAuthorizationLetter(CASE, when, { parties });
    const b = await generateAuthorizationLetter(CASE, when, { parties });
    const contentOf = (bytes: Uint8Array) =>
      Buffer.from(bytes).toString("latin1").replace(/\/(Creation|Mod)Date\s*\([^)]*\)/g, "");
    expect(contentOf(b)).toBe(contentOf(a));
    const text = await letterVisibleText(a);
    expect(text).toContain(parties.landlord.name);
    expect(text).toContain(parties.landlordWitness.name);
    expect(text).toContain(parties.tenantWitness.name);
  });

  it("still generates when the signature pool is empty", async () => {
    const when = new Date(2026, 7, 22);
    const parties = createDocumentParties(when, makeRng(3), CASE.full_name);
    const bytes = await generateAuthorizationLetter(CASE, when, {
      parties,
      signature: null,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("still generates when the case has no address at all", async () => {
    const bytes = await generateAuthorizationLetter({ ...CASE, full_address: "" }, new Date(2026, 7, 22));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("initialsOf", () => {
  it("takes at most two initials — three stops reading as a signature", () => {
    expect(initialsOf("MUHAMMAD SAHINU BIN INSANU")).toEqual(["M", "S"]);
    expect(initialsOf("Kelly Lam")).toEqual(["K", "L"]);
    expect(initialsOf("Prince")).toEqual(["P"]);
  });

  it("survives an empty name", () => {
    expect(initialsOf("")).toEqual([]);
  });
});

describe("the drawn signature", () => {
  const BOX = { x: 0, y: 0, width: 142, height: 20 };

  /** Every coordinate pair in the generated paths, in the path's own space. */
  function points(name: string): { x: number; y: number }[] {
    return signaturePaths(name, BOX).paths.flatMap(({ path }) => {
      const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      const pairs: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        pairs.push({ x: numbers[i], y: numbers[i + 1] });
      }
      return pairs;
    });
  }

  const NAMES = ["Kelly Lam", "Ivan Chong", "NAZURAH AFRINA BINTI ALIAKBAR", "S", "Ag Usman"];

  it("draws a path made of curves, not a single line", () => {
    const drawing = signaturePaths("Kelly Lam", BOX);
    expect(drawing.paths.length).toBeGreaterThanOrEqual(2); // writing + flourish
    expect(drawing.paths[0].path.match(/C /g)?.length ?? 0).toBeGreaterThan(5);
  });

  it("gives one signer the same signature every time", () => {
    expect(signaturePaths("Kelly Lam", BOX)).toEqual(signaturePaths("Kelly Lam", BOX));
  });

  it("gives every signer a different one", () => {
    const drawn = new Set(
      Array.from({ length: 40 }, (_, i) =>
        JSON.stringify(signaturePaths(`Person Number${i}`, BOX))
      )
    );
    expect(drawn.size).toBe(40);
  });

  it("never reaches below the descent it declares", () => {
    // The signature block reserves exactly FLOURISH_DESCENT beneath the line. An
    // archetype that grows past it lands on top of the IC number.
    for (const name of NAMES) {
      for (const { y } of points(name)) {
        // Path space grows downward, so the descent is a positive y.
        expect(y).toBeLessThanOrEqual(FLOURISH_DESCENT);
      }
    }
  });

  it("stays roughly within the width it was given", () => {
    for (const name of NAMES) {
      for (const { x } of points(name)) {
        // Flourishes deliberately overshoot both ends; a fifth of the box is the
        // overshoot they are allowed, and it keeps them off the margin.
        expect(x).toBeGreaterThan(-BOX.width * 0.25);
        expect(x).toBeLessThan(BOX.width * 1.25);
      }
    }
  });

  it("reaches high enough above the line to look written, but not into the heading", () => {
    // The block above reserves height x SIGNATURE_ASCENT. A gesture that climbs
    // past it is drawn through the "Property Owner Signature," line.
    for (const name of NAMES) {
      const highest = Math.min(...points(name).map((p) => p.y));
      expect(highest).toBeLessThan(-BOX.height); // taller than one cap height
      expect(highest).toBeGreaterThanOrEqual(-BOX.height * SIGNATURE_ASCENT);
    }
  });

  it("draws nothing, and throws nothing, for a nameless signer", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 100]);
    expect(() => drawSignature(page, "", { x: 20, y: 50 })).not.toThrow();
  });
});

describe("initialsOf", () => {
  it("takes at most two initials — three stops reading as a signature", () => {
    expect(initialsOf("MUHAMMAD SAHINU BIN INSANU")).toEqual(["M", "S"]);
    expect(initialsOf("Kelly Lam")).toEqual(["K", "L"]);
    expect(initialsOf("Prince")).toEqual(["P"]);
  });

  it("survives an empty name", () => {
    expect(initialsOf("")).toEqual([]);
  });
});
