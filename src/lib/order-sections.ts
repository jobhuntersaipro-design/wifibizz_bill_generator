/**
 * The New Order form's cards, as a vocabulary shared by two things that must
 * agree: the required-field bar ("2 left in Address") and a failure's
 * "fix the field" action, which opens the draft on the card that needs it.
 *
 * Kept OUT of OrderForm.tsx on purpose — that file is 2,000 lines and this is
 * the part of it that other code needs to reason about.
 */

export const FORM_SECTIONS = [
  "customer",
  "contact",
  "address",
  "package",
  "device",
  "appointment",
  "documents",
] as const;

export type FormSection = (typeof FORM_SECTIONS)[number];

export const SECTION_LABEL: Record<FormSection, string> = {
  customer: "Customer",
  contact: "Contact",
  address: "Address",
  package: "Package",
  device: "Device",
  appointment: "Appointment",
  documents: "Documents",
};

/**
 * Two letters for the phone-width bar, where "Customer 2 · Contact 2" does not
 * fit. Single initials were tried first and produced "C2 C2" — two cards, one
 * letter, no way to tell which was which.
 */
export const SECTION_SHORT: Record<FormSection, string> = {
  customer: "Cu",
  contact: "Co",
  address: "Ad",
  package: "Pk",
  device: "Dv",
  appointment: "Ap",
  documents: "Do",
};

/** The DOM id a card carries, so a section can be scrolled to. */
export const sectionAnchor = (s: FormSection): string => `section-${s}`;

/**
 * Which card each required field lives on.
 *
 * A required label that is not here THROWS rather than falling back to some
 * default section: the whole point is that the bar says where the field is,
 * and a silent "Customer" for a field on the Documents card would send the
 * agent to the wrong card with total confidence. Adding a required field means
 * placing it here, and the test suite enforces that.
 */
const SECTION_OF_LABEL: Record<string, FormSection> = {
  "ID Number": "customer",
  "Full Name": "customer",
  "Email": "contact",
  "Contact Number": "contact",
  "Full Address": "address",
  "Postcode": "address",
  "State": "address",
  "City": "address",
  "Package": "package",
  "MyKad / Passport": "documents",
  "Supporting Document": "documents",
};

export function sectionOf(label: string): FormSection {
  const s = SECTION_OF_LABEL[label];
  if (!s) throw new Error(`Required field "${label}" is not placed on a form section.`);
  return s;
}

export interface MissingField {
  label: string;
  section: FormSection;
}

export interface MissingGroup {
  section: FormSection;
  label: string;
  fields: string[];
}

/**
 * Group missing fields by card, in card order — the order the agent scrolls.
 */
export function groupMissing(missing: MissingField[]): MissingGroup[] {
  const by = new Map<FormSection, string[]>();
  for (const m of missing) {
    if (!by.has(m.section)) by.set(m.section, []);
    by.get(m.section)!.push(m.label);
  }
  return FORM_SECTIONS.filter((s) => by.has(s)).map((s) => ({
    section: s,
    label: SECTION_LABEL[s],
    fields: by.get(s)!,
  }));
}

/** Is this a section name we know? For the `?focus=` query param. */
export function isFormSection(v: string | null | undefined): v is FormSection {
  return !!v && (FORM_SECTIONS as readonly string[]).includes(v);
}
