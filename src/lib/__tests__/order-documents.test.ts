import { describe, it, expect } from "vitest";
import {
  GENERATED_DOCS,
  SERVER_DOC_TYPES,
  docSpec,
  documentSeed,
  generatableDocTypes,
  generatedFilename,
  isDocTypeAttached,
  isServerDocType,
  missingFieldsFor,
  slugFromFilename,
  type GeneratorSource,
} from "../order-documents";
import { IDENTITY_DOC_TYPES, hasIdentityDocument, hasSupportingDocument } from "../order-types";

const FULL: GeneratorSource = {
  fullName: "PHONG KONE LEE",
  idNumber: "920505-03-4434",
  fullAddress: "C-30-11 JALAN ECO MAJESTIC 3A/5, 43500 SEMENYIH, SELANGOR",
  mobile: "60148893212",
  offerName: "Unifi Home 500Mbps Premium Value With Device (36M)",
};

describe("hasIdentityDocument", () => {
  it("accepts every ID type the form can produce", () => {
    for (const type of IDENTITY_DOC_TYPES) {
      expect(hasIdentityDocument([{ type }])).toBe(true);
    }
  });

  it("rejects an order with no documents at all", () => {
    expect(hasIdentityDocument([])).toBe(false);
    expect(hasIdentityDocument(undefined)).toBe(false);
    expect(hasIdentityDocument(null)).toBe(false);
  });

  // The whole point of splitting the card: a tenancy agreement filed under
  // "Others" used to satisfy the form's hint, which read as an attached MyKad.
  it('does NOT accept "other" as an ID document', () => {
    expect(hasIdentityDocument([{ type: "other" }])).toBe(false);
  });

  it("does not accept the supporting types", () => {
    expect(hasIdentityDocument([{ type: "im_conversation" }, { type: "utility_bill" }])).toBe(false);
  });

  it("finds the ID among a full set of supporting documents", () => {
    expect(
      hasIdentityDocument([
        { type: "im_conversation" },
        { type: "utility_bill" },
        { type: "passport" },
        { type: "other" },
      ]),
    ).toBe(true);
  });
});

describe("hasSupportingDocument", () => {
  it("rejects an order with no documents at all", () => {
    expect(hasSupportingDocument([])).toBe(false);
    expect(hasSupportingDocument(undefined)).toBe(false);
    expect(hasSupportingDocument(null)).toBe(false);
  });

  // The mirror of the ID rule: an ID copy is not a supporting document, so a
  // draft holding only a MyKad still has nothing supporting it.
  it("does not count the ID copy as a supporting document", () => {
    for (const type of IDENTITY_DOC_TYPES) {
      expect(hasSupportingDocument([{ type }])).toBe(false);
    }
  });

  it("accepts an uploaded supporting document", () => {
    expect(hasSupportingDocument([{ type: "mykad" }, { type: "im_conversation" }])).toBe(true);
    expect(hasSupportingDocument([{ type: "utility_bill" }])).toBe(true);
  });

  // Every generator files under a non-identity type, so any generated document
  // satisfies the rule — including the combined PDF, which lands as "other".
  it("accepts every generated document type, and the combined PDF", () => {
    for (const spec of GENERATED_DOCS) {
      expect(hasSupportingDocument([{ type: "mykad" }, { type: spec.type }])).toBe(true);
    }
    expect(hasSupportingDocument([{ type: "other" }])).toBe(true);
  });
});

describe("missingFieldsFor", () => {
  it("enables every button when the form is complete", () => {
    for (const g of GENERATED_DOCS) {
      expect(missingFieldsFor(g.type, FULL)).toEqual([]);
    }
  });

  it("names every missing field on an empty form", () => {
    expect(missingFieldsFor("chat", {})).toEqual([
      "Full Name",
      "ID Number",
      "Installation Address",
      "Phone Number",
      "Package",
    ]);
  });

  // The letter is the only document that prints the IC, and the chat is the only
  // one that prints the package — so they block on different fields.
  it("blocks the authorization letter on the ID number but not the package", () => {
    expect(missingFieldsFor("authorization_letter", { ...FULL, offerName: "" })).toEqual([]);
    expect(missingFieldsFor("authorization_letter", { ...FULL, idNumber: "" })).toEqual(["ID Number"]);
  });

  it("blocks the chat on the package", () => {
    expect(missingFieldsFor("chat", { ...FULL, offerName: "" })).toEqual(["Package"]);
  });

  it("blocks the bills on the phone number, which the letter and invoice do not print", () => {
    expect(missingFieldsFor("internet_bill", { ...FULL, mobile: "" })).toEqual(["Phone Number"]);
    expect(missingFieldsFor("utility_bill", { ...FULL, mobile: "" })).toEqual(["Phone Number"]);
    expect(missingFieldsFor("time_invoice", { ...FULL, mobile: "" })).toEqual([]);
  });

  it("enables TA when the form is complete", () => {
    expect(missingFieldsFor("tenancy_agreement", FULL)).toEqual([]);
  });

  it("blocks TA on Full Name, ID Number, and Installation Address", () => {
    expect(missingFieldsFor("tenancy_agreement", { ...FULL, fullName: "" })).toEqual(["Full Name"]);
    expect(missingFieldsFor("tenancy_agreement", { ...FULL, idNumber: "" })).toEqual(["ID Number"]);
    expect(missingFieldsFor("tenancy_agreement", { ...FULL, fullAddress: "" })).toEqual([
      "Installation Address",
    ]);
  });

  it("does not block TA on empty mobile or package", () => {
    expect(missingFieldsFor("tenancy_agreement", { ...FULL, mobile: "" })).toEqual([]);
    expect(missingFieldsFor("tenancy_agreement", { ...FULL, offerName: "" })).toEqual([]);
  });

  it("treats whitespace as missing", () => {
    expect(missingFieldsFor("time_invoice", { ...FULL, fullName: "   " })).toEqual(["Full Name"]);
  });
});

describe("documentSeed", () => {
  // Every generator derives its account number, invoice number, owner identity
  // and dates from this. If it were not stable, regenerating would hand out a
  // different property owner for the same premise.
  it("is stable across the formatting the form applies to a MyKad", () => {
    expect(documentSeed("920505-03-4434")).toBe("920505034434");
    expect(documentSeed("920505034434")).toBe("920505034434");
    expect(documentSeed(" 920505 03 4434 ")).toBe("920505034434");
  });

  it("keeps a passport's letters", () => {
    expect(documentSeed("A12345678")).toBe("A12345678");
  });

  it("does not collide across two customers", () => {
    expect(documentSeed("920505034434")).not.toBe(documentSeed("920505034435"));
  });
});

describe("attach mapping", () => {
  it("introduces no new document vocabulary", () => {
    // The scraper reads `im_paths` and `id_paths` and treats the rest
    // generically; a new type here would mean changing that contract too.
    const allowed = ["im_conversation", "utility_bill", "other"];
    for (const g of GENERATED_DOCS) {
      expect(allowed).toContain(g.attachAs);
    }
  });

  it("never attaches a generated document as the ID copy", () => {
    for (const g of GENERATED_DOCS) {
      expect(IDENTITY_DOC_TYPES).not.toContain(g.attachAs as never);
    }
  });

  it("gives every 'other' document a filename slug so stored names stay readable", () => {
    for (const g of GENERATED_DOCS.filter((d) => d.attachAs === "other")) {
      expect(g.attachLabel).toMatch(/^[a-z]+$/);
    }
  });

  it("has a distinct slug per document", () => {
    const slugs = GENERATED_DOCS.map((g) => g.attachLabel).filter(Boolean);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("server vs client documents", () => {
  it("routes the five PDFs to the server and the chat to the client", () => {
    expect(SERVER_DOC_TYPES).toHaveLength(5);
    expect(isServerDocType("chat")).toBe(false);
    for (const t of SERVER_DOC_TYPES) expect(isServerDocType(t)).toBe(true);
  });

  it("rejects an unknown type rather than guessing", () => {
    expect(isServerDocType("payslip")).toBe(false);
    expect(() => docSpec("payslip" as never)).toThrow(/Unknown generated document type/);
  });

  it("names the chat .png and the rest .pdf", () => {
    expect(generatedFilename("chat", "920505034434")).toBe("chat_920505034434.png");
    expect(generatedFilename("time_invoice", "920505034434")).toBe("time_invoice_920505034434.pdf");
    expect(generatedFilename("tenancy_agreement", "920505034434")).toBe(
      "tenancy_agreement_920505034434.pdf",
    );
  });
});


describe("slugFromFilename", () => {
  // Filenames are {idNumber}_{slug}_{suffix}.{ext}. This is read back out rather
  // than tracked in state because it is the only record that survives saving a
  // draft and loading it again.
  it("reads the slug out of a stored filename", () => {
    expect(slugFromFilename("920505034434_internetbill_1.pdf")).toBe("internetbill");
    expect(slugFromFilename("920505034434_utilitybill_2.pdf")).toBe("utilitybill");
    expect(slugFromFilename("920505034434_imconversation_1.png")).toBe("imconversation");
  });

  it("handles the MyKad front/back suffix, which is a word not a number", () => {
    expect(slugFromFilename("920505034434_mykad_front.png")).toBe("mykad");
  });

  it("is not confused by a passport ID number carrying letters", () => {
    expect(slugFromFilename("A12345678_timeinvoice_1.pdf")).toBe("timeinvoice");
  });

  it("returns null for anything not shaped like one", () => {
    expect(slugFromFilename("scan.pdf")).toBeNull();
    expect(slugFromFilename("920505034434_mykad.png")).toBeNull();
  });
});

describe("isDocTypeAttached", () => {
  const attached = (...names: string[]) => names.map((filename) => ({ filename }));

  it("blocks a kind that is already on the order", () => {
    expect(isDocTypeAttached("internet_bill", attached("920505034434_internetbill_1.pdf"))).toBe(true);
  });

  it("allows everything on an empty order", () => {
    for (const g of GENERATED_DOCS) {
      expect(isDocTypeAttached(g.type, [])).toBe(false);
    }
  });

  // Each kind must block only itself — two of these share the "other" docType and
  // are told apart by their slug alone.
  it("blocks only its own kind", () => {
    const docs = attached("920505034434_internetbill_1.pdf");
    expect(isDocTypeAttached("internet_bill", docs)).toBe(true);
    expect(isDocTypeAttached("utility_bill", docs)).toBe(false);
    expect(isDocTypeAttached("time_invoice", docs)).toBe(false);
    expect(isDocTypeAttached("authorization_letter", docs)).toBe(false);
    expect(isDocTypeAttached("tenancy_agreement", docs)).toBe(false);
    expect(isDocTypeAttached("chat", docs)).toBe(false);
  });

  it("matches only *_tenancyagreement_* filenames for TA", () => {
    expect(
      isDocTypeAttached("tenancy_agreement", attached("920505034434_tenancyagreement_1.pdf")),
    ).toBe(true);
    expect(
      isDocTypeAttached("tenancy_agreement", attached("920505034434_authorizationletter_1.pdf")),
    ).toBe(false);
    expect(
      isDocTypeAttached("tenancy_agreement", attached("920505034434_timeinvoice_1.pdf")),
    ).toBe(false);
    expect(
      isDocTypeAttached("tenancy_agreement", attached("920505034434_internetbill_1.pdf")),
    ).toBe(false);
    expect(
      isDocTypeAttached("tenancy_agreement", attached("920505034434_utilitybill_1.pdf")),
    ).toBe(false);
    expect(
      isDocTypeAttached("tenancy_agreement", attached("920505034434_imconversation_1.png")),
    ).toBe(false);
  });

  // "However it arrived" — the order should not carry two utility bills that
  // disagree, and who made them does not change that.
  it("counts a manually uploaded file of the same type", () => {
    expect(isDocTypeAttached("utility_bill", attached("920505034434_utilitybill_1.pdf"))).toBe(true);
  });

  it("is not fooled by a substring of another slug", () => {
    // "internetbill" contains "bill" but must not match "utilitybill".
    expect(isDocTypeAttached("utility_bill", attached("920505034434_internetbill_1.pdf"))).toBe(false);
  });

  it("ignores the MyKad, which is not a generated kind", () => {
    for (const g of GENERATED_DOCS) {
      expect(isDocTypeAttached(g.type, attached("920505034434_mykad_1.png"))).toBe(false);
    }
  });

  // Combining replaces every supporting document with one PDF, so the individual
  // slugs disappear and all five become available again. Pinned so the behaviour
  // is a decision on the record rather than an accident.
  it("unblocks every kind after a combine has replaced them", () => {
    const docs = attached("920505034434_mykad_1.png", "920505034434_combined_1.pdf");
    for (const g of GENERATED_DOCS) {
      expect(isDocTypeAttached(g.type, docs)).toBe(false);
    }
  });
});

describe("spec slugs match what the uploader stores", () => {
  // docSlug lives in a "use server" file and cannot be imported, so the two are
  // pinned here instead. If the upload action's slugging changes, this fails.
  it("derives each slug the way docSlug would", () => {
    for (const g of GENERATED_DOCS) {
      const expected =
        g.attachAs === "other"
          ? g.attachLabel
          : g.attachAs === "utility_bill"
            ? "utilitybill"
            : "imconversation";
      expect(g.slug).toBe(expected);
    }
  });

  it("gives every kind a distinct slug", () => {
    const slugs = GENERATED_DOCS.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("generatableDocTypes", () => {
  const attached = (...names: string[]) => names.map((filename) => ({ filename }));

  it("returns all six, in card order, for a filled form with nothing attached", () => {
    expect(generatableDocTypes(FULL, [], 10)).toEqual([
      "chat",
      "internet_bill",
      "utility_bill",
      "tenancy_agreement",
      "authorization_letter",
      "time_invoice",
    ]);
  });

  it("skips kinds that are already attached, however they arrived", () => {
    const docs = attached(
      "920505034434_imconversation_1.png",
      "920505034434_timeinvoice_1.pdf",
    );
    expect(generatableDocTypes(FULL, docs, 10)).toEqual([
      "internet_bill",
      "utility_bill",
      "tenancy_agreement",
      "authorization_letter",
    ]);
  });

  it("skips kinds whose required fields are missing", () => {
    const source = { ...FULL, offerName: "" };
    expect(generatableDocTypes(source, [], 10)).toEqual([
      "internet_bill",
      "utility_bill",
      "tenancy_agreement",
      "authorization_letter",
      "time_invoice",
    ]);
  });

  it("caps the queue to the attachment slots left", () => {
    expect(generatableDocTypes(FULL, [], 2)).toEqual(["chat", "internet_bill"]);
    expect(generatableDocTypes(FULL, [], 0)).toEqual([]);
    // A negative slot count (more docs than the cap allows) must not throw.
    expect(generatableDocTypes(FULL, [], -1)).toEqual([]);
  });

  it("returns empty when nothing can run at all", () => {
    expect(generatableDocTypes({}, [], 10)).toEqual([]);
  });
});
