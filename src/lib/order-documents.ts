// Generating documents from an ORDER DRAFT rather than a crawled WifiBizz case.
//
// The generators in src/lib/bill-generator/* already take a plain struct, not a
// database row — it is the five /api/bills/* routes that are welded to
// `wifibizz_cases`. An order draft carries every field those structs need, so
// everything here is about routing and seeding, not about generation.
//
// Shared by the order form (which buttons are enabled), the generate-document
// route (what to build) and the dialog (what to attach it as), so the three can
// never disagree about what a document needs.

import { isBusinessCase } from "./case-kind";
import type { ChatScriptVariant } from "./chat-script";

/** The documents an order draft can produce. */
export type GeneratedDocType =
  | "chat"
  | "bizz_chat"
  | "internet_bill"
  | "utility_bill"
  | "tenancy_agreement"
  | "authorization_letter"
  | "biz_authorization_letter"
  | "time_invoice";

export const SERVER_DOC_TYPES = [
  "internet_bill",
  "utility_bill",
  "tenancy_agreement",
  "authorization_letter",
  "biz_authorization_letter",
  "time_invoice",
] as const;

export type ServerDocType = (typeof SERVER_DOC_TYPES)[number];

export function isServerDocType(v: string): v is ServerDocType {
  return (SERVER_DOC_TYPES as readonly string[]).includes(v);
}

/** The order-form fields a generator reads. */
export interface GeneratorSource {
  fullName: string;
  idNumber: string;
  fullAddress: string;
  mobile: string;
  offerName: string;
  offerCategory?: string;
  serviceCategory?: string;
  companyName?: string;
  companyReg?: string;
  /** WifiBizz Customer-tab Name — the director, not the company. */
  directorName?: string;
}

export interface GeneratedDocSpec {
  type: GeneratedDocType;
  label: string;
  /** Form fields that must be non-empty, in the order they are reported. */
  requires: { field: keyof GeneratorSource; label: string }[];
  /**
   * The upload `docType` this attaches under. No new document vocabulary is
   * introduced: the scraper reads `im_paths` and `id_paths` and treats the rest
   * generically, so inventing types here would mean changing that contract too.
   */
  attachAs: "im_conversation" | "utility_bill" | "other";
  /**
   * Filename slug when attachAs is `other`, or when two `im_conversation` kinds
   * need distinct stored names (Conversation Chat vs Bizz Chat).
   */
  attachLabel?: string;
  /**
   * The slug this document's filename carries once stored, i.e. the middle part
   * of `{idNumber}_{slug}_{n}.{ext}`. It mirrors `docSlug` in the upload action,
   * which lives in a "use server" file and so cannot be imported here — the test
   * suite pins the two together.
   */
  slug: string;
  ext: "pdf" | "png";
  /**
   * Set on the documents rasterised from the WhatsApp chrome in the browser,
   * naming which closing script the chrome shows. The rest come from the server
   * as PDFs.
   */
  chatVariant?: ChatScriptVariant;
}

const NAME = { field: "fullName", label: "Full Name" } as const;
const ID = { field: "idNumber", label: "ID Number" } as const;
const ADDR = { field: "fullAddress", label: "Installation Address" } as const;
const MOBILE = { field: "mobile", label: "Phone Number" } as const;
const PKG = { field: "offerName", label: "Package" } as const;

export const GENERATED_DOCS: GeneratedDocSpec[] = [
  {
    type: "chat",
    label: "Conversation Chat",
    // The script prints the package and the install date alongside the customer,
    // so a chat generated before a package is picked would show a dash where the
    // thing being sold belongs.
    requires: [NAME, ID, ADDR, MOBILE, PKG],
    attachAs: "im_conversation",
    slug: "imconversation",
    ext: "png",
    chatVariant: "conversation",
  },
  {
    type: "bizz_chat",
    label: "Bizz Chat",
    requires: [NAME, ID, ADDR, MOBILE, PKG],
    attachAs: "im_conversation",
    attachLabel: "bizzchat",
    slug: "bizzchat",
    ext: "png",
    chatVariant: "bizz",
  },
  {
    type: "internet_bill",
    label: "Internet Bill",
    requires: [NAME, ID, ADDR, MOBILE],
    attachAs: "other",
    attachLabel: "internetbill",
    slug: "internetbill",
    ext: "pdf",
  },
  {
    type: "utility_bill",
    label: "Utility Bill",
    requires: [NAME, ID, ADDR, MOBILE],
    attachAs: "utility_bill",
    slug: "utilitybill",
    ext: "pdf",
  },
  {
    type: "tenancy_agreement",
    label: "TA",
    requires: [NAME, ID, ADDR],
    attachAs: "other",
    attachLabel: "tenancyagreement",
    slug: "tenancyagreement",
    ext: "pdf",
  },
  {
    type: "authorization_letter",
    label: "Auth Letter",
    requires: [NAME, ID, ADDR],
    attachAs: "other",
    attachLabel: "authorizationletter",
    slug: "authorizationletter",
    ext: "pdf",
  },
  {
    // The business letter. A different document from the residential Auth Letter
    // above, not a relabelling of it, and the two are mutually exclusive: plan
    // type picks one, and `generatableDocTypes` never offers both.
    //
    // Company name, BRN and the director are read from the case rather than the
    // form, so its `requires` cannot name them — a business order whose detail
    // page has not been fetched prints those lines blank rather than being
    // refused, which is the brief's rule.
    type: "biz_authorization_letter",
    label: "Biz Auth Letter",
    requires: [NAME, ID, ADDR],
    attachAs: "other",
    attachLabel: "bizauthorizationletter",
    slug: "bizauthorizationletter",
    ext: "pdf",
  },
  {
    type: "time_invoice",
    label: "TIME Invoice",
    requires: [NAME, ID, ADDR],
    attachAs: "other",
    attachLabel: "timeinvoice",
    slug: "timeinvoice",
    ext: "pdf",
  },
];

export function docSpec(type: GeneratedDocType): GeneratedDocSpec {
  const spec = GENERATED_DOCS.find((d) => d.type === type);
  if (!spec) throw new Error(`Unknown generated document type: ${type}`);
  return spec;
}

/**
 * The fields this document needs that the form has not filled yet. Empty means
 * the button is enabled. A button whose inputs are missing is disabled WITH the
 * reason named — not hidden, and not enabled-then-failing.
 */
export function missingFieldsFor(
  type: GeneratedDocType,
  source: Partial<GeneratorSource>,
): string[] {
  return docSpec(type)
    .requires.filter((r) => !String(source[r.field] ?? "").trim())
    .map((r) => r.label);
}

/**
 * The deterministic seed the generators take as `case_no`.
 *
 * Every generator derives its account number, invoice number, owner identity and
 * dates from this, so it MUST be stable: regenerating has to produce the same
 * document, or two downloads of one letter would name two different property
 * owners for one premise (the reason the letter work rejected randomness).
 *
 * An order draft has no case_no. The alternatives all fail on a form that has
 * never been saved — `reference` is assigned at save (and is null forever on
 * bulk-created drafts) and the cuid does not exist yet — so the seed is the
 * normalized ID number, which is required, present before generation is possible,
 * and unchanged across save-and-reload.
 *
 * Accepted consequence: two orders for the same customer generate identical
 * account and invoice numbers. For a utility bill naming one person at one
 * premise that is arguably correct rather than a collision.
 */
export function documentSeed(idNumber: string): string {
  return idNumber.replace(/[^A-Za-z0-9]/g, "");
}

/** Download filename for a generated document. */
export function generatedFilename(type: GeneratedDocType, seed: string): string {
  const spec = docSpec(type);
  return `${type}_${seed || "order"}.${spec.ext}`;
}

type StoredDocName = { filename: string; key?: string };

/**
 * An uploaded file's own name, made safe to store and to hand to the portal.
 *
 * A file the agent uploads keeps the name it had on their device — that is what
 * the tray, the download and the portal attachment show. Only the path is
 * dropped and anything outside `[A-Za-z0-9 ._()-]` becomes `_`: the name ends up
 * in a Content-Disposition header, which cannot carry non-Latin-1 text, and the
 * document routes refuse any key containing `..`.
 */
export function safeUploadFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const stem = (dot >= 0 ? base.slice(0, dot) : base)
    .replace(/[^A-Za-z0-9 ._()-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/_{2,}/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 100)
    .trim();
  return `${stem || "document"}${ext ? `.${ext}` : ""}`;
}

/**
 * The `{idNumber}_{slug}_{suffix}` name that identifies a document's slot.
 *
 * A file uploaded under its original name is stored at
 * `orders/{user}/{idNumber}_{slug}_{suffix}/{original name}`, so the slot lives
 * in the folder and the filename is free to be whatever the agent's file was
 * called. Generated and combined documents are still stored flat, where the
 * filename IS the slot.
 */
export function documentSlotName(doc: StoredDocName): string {
  const parts = (doc.key ?? "").split("/");
  return parts.length >= 4 ? parts[parts.length - 2] : doc.filename;
}

/**
 * The slug in a stored document's filename, or null if it is not shaped like one.
 *
 * Filenames are `{idNumber}_{slug}_{suffix}.{ext}` and the slug is always
 * `[a-z0-9]+`, so the middle is everything between the first and last underscore.
 * This is read back out rather than tracked in state because it is the only
 * record that survives saving a draft and loading it again.
 */
export function slugFromFilename(filename: string): string | null {
  const stem = filename.replace(/\.[^.]+$/, "");
  const parts = stem.split("_");
  if (parts.length < 3) return null;
  return parts.slice(1, -1).join("_") || null;
}

/**
 * Is a document of this kind already on the order?
 *
 * Each kind can be generated once, and "once" is measured against what is
 * ATTACHED rather than what has ever been generated: removing the row makes it
 * available again, which is both self-healing and visible on screen. It counts a
 * manually uploaded utility bill too — the point is that the order should not
 * carry two utility bills that disagree, and who made them does not change that.
 *
 * A consequence worth knowing: combining replaces every supporting document with
 * a single PDF, so the individual slugs disappear and all five become available
 * again. Generating one then leaves a copy both inside the combined file and
 * beside it.
 */
export function isDocTypeAttached(
  type: GeneratedDocType,
  docs: readonly StoredDocName[],
): boolean {
  const slug = docSpec(type).slug;
  return docs.some((d) => slugFromFilename(documentSlotName(d)) === slug);
}

/**
 * What "Generate all" would run right now, in GENERATED_DOCS order: every
 * generator that is not already attached and has its required fields, capped to
 * the attachment slots left. This is the same test each card's button applies,
 * held in one place so the button's count and the queue it starts cannot
 * disagree — and the queue re-applies it before each step, since every attach
 * consumes a slot and can change the answer.
 */
export function isBusinessOrder(source: Partial<GeneratorSource>): boolean {
  return isBusinessCase({
    provider: source.serviceCategory,
    package: source.offerName,
    offer_category: source.offerCategory,
    company_name: source.companyName,
    company_reg: source.companyReg,
    full_name: source.fullName,
  });
}

export function generatableDocTypes(
  source: Partial<GeneratorSource>,
  docs: readonly StoredDocName[],
  slotsLeft: number,
): GeneratedDocType[] {
  return GENERATED_DOCS.filter(
    (g) =>
      !isDocTypeAttached(g.type, docs) &&
      missingFieldsFor(g.type, source).length === 0 &&
      (g.type !== "bizz_chat" || isBusinessOrder(source)) &&
      (g.type !== "chat" || !isBusinessOrder(source)) &&
      // Same XOR as the two chats: the business letter only for a business
      // order, the residential one only for a normal order. Never both.
      (g.type !== "biz_authorization_letter" || isBusinessOrder(source)) &&
      (g.type !== "authorization_letter" || !isBusinessOrder(source)),
  )
    .slice(0, Math.max(0, slotsLeft))
    .map((g) => g.type);
}
