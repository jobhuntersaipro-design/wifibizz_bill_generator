"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import LottieSpot from "./LottieSpot";
import {
  saveOrder,
  uploadOrderDocument,
  lookupPostcode,
  getOrder,
} from "@/actions/order";
import {
  MAX_DOCS,
  IDENTITY_DOC_TYPES,
  hasIdentityDocument,
  hasSupportingDocument,
  type OrderDocument,
} from "@/lib/order-types";
import { GENERATED_DOCS, docSpec, generatableDocTypes, isDocTypeAttached, missingFieldsFor, type GeneratedDocType } from "@/lib/order-documents";
import {
  COMBINED_DOC_LABEL,
  COMBINED_DOC_TYPE,
  MIN_COMBINE,
  applyCombine,
  canCombine,
  isImageDocument,
  mergeLabel,
  moveDoc,
} from "@/lib/order-merge";
import { mergePdfs } from "@/lib/bill-generator/merge-pdfs";
import { pngToPdfPage } from "@/lib/bill-generator/image-page";
import { contentTypeFor, imageBytesToPng } from "@/lib/browser-image";
import GenerateDocRunner from "./GenerateDocRunner";
import { getPublishedPlans, getPlanOffer } from "@/actions/plans";
import { parseMykad, inferRace, formatMykad, isCompleteMykad, isValidEmail } from "@/lib/mykad";
import {
  DEFAULT_LEAD_HOURS,
  MAX_LEAD_HOURS,
  MIN_LEAD_HOURS,
  describeLeadTime,
  leadHoursOrDefault,
  validateLeadHours,
} from "@/lib/appointment-settings";
import {
  DEALER_OFFERS,
  OFFER_CATEGORIES,
  ID_TYPES,
  MYKAD_LIKE_ID_TYPES,
  type IdType,
} from "@/lib/dealer-offers";
import { DEALER_DEVICES } from "@/lib/dealer-devices";
import { deviceRequired, type PlanOfferSplit } from "@/lib/plan-offer";
import {
  DEVICE_CATEGORIES,
  DEVICE_CATEGORY_COUNTS,
  deviceCategory,
  deviceFamily,
  groupDevices,
  isAmbiguousDevice,
  variantLabel,
} from "@/lib/device-catalog";
import { MALAYSIA_STATES } from "@/lib/malaysia-states";
import { validateMalaysianAddress, parseMalaysianAddress } from "@/lib/malaysia-address";

// Shared field styles — light border + hover to signal clickability.
const inputCls =
  "rounded-lg h-10 border-[#E3E8EF] hover:border-[#635BFF]/60 focus:border-[#635BFF] transition-colors";
const selectCls =
  "select-chevron w-full pl-3 h-10 rounded-lg border border-[#CBD2DC] bg-white text-sm text-[#0A2540] hover:border-[#635BFF] focus:border-[#635BFF] focus:outline-none cursor-pointer transition-colors";
const labelCls = "text-xs font-medium text-[#425466]";
// The two ways a supporting document reaches an order. `short` is used below
// 640px, where "Generate from order" wraps to two lines and leaves the two tabs
// at different heights.
const DOC_SOURCES = [
  { id: "upload" as const, label: "Upload a file", short: "Upload" },
  { id: "generate" as const, label: "Generate from order", short: "Generate" },
];
const cardCls = "bg-white rounded-lg border border-[#E3E8EF]";
const headCls = "px-6 py-3 border-b border-[#E3E8EF] text-sm font-semibold text-[#0A2540]";

// Add-on flavour of an offer, derived from its portal name. Display order —
// plain packages first, then the bundles, since plain is the common case.
const FLAVOURS = [
  "Plain broadband",
  "With Netflix",
  "With MAX",
  "With TV pack",
  "With Device",
  "5G SIM bundle",
  "PrimePromo",
  "Premium Value",
] as const;

// Order matters: the first match wins, so the most order-affecting add-on is
// checked first. A package bundling both a 5G SIM and a TV pack files under
// 5G SIM — the SIM count is what the agent has to get right.
function offerFlavour(name: string): (typeof FLAVOURS)[number] {
  const n = name.toLowerCase();
  if (/with\s*device/.test(n)) return "With Device";
  if (n.includes("netflix")) return "With Netflix";
  if (n.includes("uni5g")) return "5G SIM bundle";
  if (/\bmax\b/.test(n)) return "With MAX";
  if (/value\s*(tv\s*)?pack/.test(n)) return "With TV pack";
  if (n.includes("primepromo")) return "PrimePromo";
  if (n.includes("premium value")) return "Premium Value";
  return "Plain broadband";
}

/** Speed chips, in the order the portal lists them. BIZ/VOF are separate. */
const SPEED_CHIPS = ["100M", "300M", "500M", "1G", "2G", "BIZ", "VOF"] as const;
const SPEED_LABELS: Record<string, string> = {
  "100M": "100Mbps", "300M": "300Mbps", "500M": "500Mbps",
  "1G": "1Gbps", "2G": "2Gbps", BIZ: "Business", VOF: "VOF",
};

/** Inline validation error marker — icon + text, never colour alone. */
function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

/** Marks values the system derived rather than the agent typing them. */
function AutoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0 text-[#635BFF]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  );
}

export function OrderForm({
  editingId,
  onSaved,
  onBack,
}: {
  editingId?: string | null;
  onSaved?: () => void;
  onBack?: () => void;
}) {
  const [draftId, setDraftId] = useState<string | null>(editingId ?? null);
  const [loadingDraft, setLoadingDraft] = useState(!!editingId);

  const [idType, setIdType] = useState<IdType>("MyKad");
  const [idNumber, setIdNumber] = useState("");
  const [idExpiry, setIdExpiry] = useState("");
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState("");
  const [birthday, setBirthday] = useState("");
  const [race, setRace] = useState("");

  const [mobilePrefix, setMobilePrefix] = useState("60");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const mobileRef = useRef<HTMLInputElement>(null);

  // ONE address field: the agent pastes the complete address exactly as the
  // Unifi portal renders it. There is no Confirm step — the agent carries full
  // responsibility for its accuracy, and the submit run searches the portal
  // with this text as-is. Postcode / state / city are derived from it as they
  // type, and stay editable.
  const [postcode, setPostcode] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [detecting, setDetecting] = useState(false);

  // Portal resourceInstId carried by drafts saved under the old Confirm flow.
  // Never set by this form anymore, but when present the scraper still selects
  // the exact unit "By Address Id" — so it is kept, and cleared if the agent
  // edits the address it belonged to.
  const [addressId, setAddressId] = useState("");
  const [addressFull, setAddressFull] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [addrError, setAddrError] = useState("");

  const [offerName, setOfferName] = useState("");
  const [offerCategory, setOfferCategory] = useState("");
  const [pkgQuery, setPkgQuery] = useState("");
  const [speedFilter, setSpeedFilter] = useState("");
  const [pkgOpen, setPkgOpen] = useState(false);
  // Names of plans an admin has published. null while loading — the picker then
  // shows the static list rather than flashing an empty dropdown.
  const [publishedNames, setPublishedNames] = useState<Set<string> | null>(null);
  const pkgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    getPublishedPlans()
      .then((r) => {
        if (!active) return;
        if (r.success) setPublishedNames(new Set(r.plans.map((p) => p.name)));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const [deviceCode, setDeviceCode] = useState("");
  // What an admin recorded for the CURRENTLY selected plan. Held with the plan
  // name so switching package can't leave the previous plan's devices applied.
  const [planOffer, setPlanOffer] = useState<{ offer: string } & PlanOfferSplit>({
    offer: "",
    devices: [],
    channels: [],
    discounts: [],
    known: false,
  });
  const [deviceName, setDeviceName] = useState("");
  const [devQuery, setDevQuery] = useState("");
  const [devCategory, setDevCategory] = useState("");
  const [devOpen, setDevOpen] = useState(false);
  const devRef = useRef<HTMLDivElement>(null);

  const [remarks, setRemarks] = useState("");
  // Appointment lead time, as typed. Held as a string so the field can be
  // emptied while editing — a number state would snap a cleared box back to 0.
  const [leadHours, setLeadHours] = useState(String(DEFAULT_LEAD_HOURS));

  const [documents, setDocuments] = useState<OrderDocument[]>([]);
  const [docType, setDocType] = useState("im_conversation");
  const [otherLabel, setOtherLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  // Which drop zone is currently under a drag. Two zones share one flag because
  // only one can be hovered at a time, and a boolean would highlight both.
  const [dragZone, setDragZone] = useState<"identity" | "supporting" | null>(null);
  // The document currently being generated. It attaches itself and clears — the
  // spinner shows on the button that started it.
  const [genDoc, setGenDoc] = useState<GeneratedDocType | null>(null);
  // What "Generate all" still has to run after genDoc — sequential on purpose,
  // since each stored filename's sequence counts the documents already attached.
  const [genQueue, setGenQueue] = useState<GeneratedDocType[]>([]);
  // Batch bookkeeping for the end-of-run summary. A ref, not state: it never
  // drives a render of its own, and the renders genDoc causes read it fresh.
  const genBatchRef = useRef({ active: false, total: 0, ok: 0, failed: [] as string[] });
  // `collapsingKeys` and `arrivedKey` exist only to drive the animation: a
  // combine replaces rows the agent is looking at, so the merged ones collapse
  // in place and the file that takes their position announces itself once.
  const [collapsingKeys, setCollapsingKeys] = useState<string[]>([]);
  const [arrivedKey, setArrivedKey] = useState<string | null>(null);
  const [combining, setCombining] = useState(false);
  // Which of the two ways to add a document is showing. Upload leads because it
  // is the one an agent arrives with a file in hand for; generating is the
  // alternative you reach for when you do not have one.
  const [docSource, setDocSource] = useState<"upload" | "generate">("upload");

  const [saving, setSaving] = useState(false);

  const isMykadLike = MYKAD_LIKE_ID_TYPES.includes(idType);
  // Email is required — the scraper types it straight into the portal's
  // emailAddr field, and a blank one only surfaces as a "data incomplete"
  // rejection much later in the flow.
  const emailValid = isValidEmail(email);
  // Only complain about a half-typed ID once the agent has moved on / typed
  // enough to mean it — an empty field is the "required" error, not this one.
  const idNumberIncomplete = isMykadLike && idNumber.length > 0 && !isCompleteMykad(idNumber);

  // What still stands between the agent and a saveable draft, in the order the
  // form asks for it. Informational only — the save handler stays the sole
  // validator — but the sticky bar can then answer "why can't I save yet?"
  // without the agent scrolling back up to look for red marks.
  const missingRequired = useMemo(() => {
    const missing: string[] = [];
    if (isMykadLike ? !isCompleteMykad(idNumber) : !idNumber.trim()) missing.push("ID Number");
    if (!fullName.trim()) missing.push("Full Name");
    if (!emailValid) missing.push("Email");
    if (!street.trim()) missing.push("Full Address");
    if (!/^\d{5}$/.test(postcode.trim())) missing.push("Postcode");
    if (!stateVal) missing.push("State");
    if (!city.trim()) missing.push("City");
    if (!offerName) missing.push("Package");
    // The ID copy is required by the portal's Personal Customer form, so it is a
    // save-blocker like any other required field rather than a nice-to-have.
    if (!hasIdentityDocument(documents)) missing.push("MyKad / Passport");
    // Same rule, one card down: the order needs the paperwork behind it too.
    if (!hasSupportingDocument(documents)) missing.push("Supporting Document");
    return missing;
  }, [isMykadLike, idNumber, fullName, emailValid, street, postcode, stateVal, city, offerName, documents]);

  // The ID copy follows the chosen ID Type and lives in its own card, so it is
  // NOT one of the Supporting card's select options — the card is the type.
  const idDocType = isMykadLike ? "mykad" : idType === "Passport" ? "passport" : "id";
  const idDocLabel = isMykadLike ? "MyKad" : idType === "Passport" ? "Passport" : "ID Document";
  const docTypeOptions = [
    { value: "im_conversation", label: "IM Conversation" },
    { value: "other", label: "Others" },
    { value: "utility_bill", label: "Utility Bill" },
  ];
  // "other" is deliberately not an identity document — see hasIdentityDocument.
  const hasIdentityDoc = hasIdentityDocument(documents);
  const hasSupportingDoc = hasSupportingDocument(documents);
  const identityDocs = documents.filter((d) => IDENTITY_DOC_TYPES.includes(d.type as never));
  const supportingDocs = documents.filter((d) => !IDENTITY_DOC_TYPES.includes(d.type as never));
  const docsFull = documents.length >= MAX_DOCS;


  // What each generator reads off the form. Held in one object so the buttons,
  // the dialog and the route all see the same values.
  const genSource = {
    fullName: fullName.trim(),
    idNumber: idNumber.trim(),
    fullAddress: street.trim(),
    mobile: `${mobilePrefix}${mobile}`.trim(),
    offerName,
    idType,
    email: email.trim(),
    serviceCategory,
  };

  // What "Generate all" would run right now. Also the button's count, so the
  // label and the queue it starts can never disagree.
  const generateAllTypes = generatableDocTypes(genSource, documents, MAX_DOCS - documents.length);

  function handleGenerateAll() {
    if (generateAllTypes.length === 0 || genDoc !== null) return;
    genBatchRef.current = { active: true, total: generateAllTypes.length, ok: 0, failed: [] };
    setGenQueue(generateAllTypes.slice(1));
    setGenDoc(generateAllTypes[0]);
  }

  // Derive gender + birthday during the change (no effect needed).
  function applyMykad(ic: string) {
    const info = parseMykad(ic);
    if (info) {
      setGender(info.gender);
      setBirthday(info.birthday);
    }
  }
  function handleIdTypeChange(t: IdType) {
    setIdType(t);
    if (MYKAD_LIKE_ID_TYPES.includes(t)) applyMykad(idNumber);
  }
  function handleIdNumberChange(raw: string) {
    const mykadLike = MYKAD_LIKE_ID_TYPES.includes(idType);
    // Portal fields are keyed in uppercase; MyKad is digits-only.
    const val = mykadLike ? raw.replace(/\D/g, "").slice(0, 12) : raw.toUpperCase();
    setIdNumber(val);
    if (mykadLike) applyMykad(val);
  }

  // 60 offers is too many for one flat list. Narrow by speed first (the thing
  // the customer actually asked for), then group what's left by add-on flavour
  // — that's the real second axis, since only 9 offers are "with Device" and
  // the device itself is a separate step after the package.
  const filteredOffers = useMemo(() => {
    const q = pkgQuery.trim().toLowerCase();
    // Published plans only. An unpublished plan is one whose portal offer groups
    // no admin has confirmed, and selling it is what produced the "can't be
    // subscribed through Contactless Journey" rejections.
    const sellable = publishedNames === null
      ? DEALER_OFFERS
      : DEALER_OFFERS.filter((o) => publishedNames.has(o.name));
    return sellable.filter((o) => {
      if (q && !o.name.toLowerCase().includes(q)) return false;
      if (!speedFilter) return true;
      if (speedFilter === "BIZ" || speedFilter === "VOF") return o.category === OFFER_CATEGORIES[speedFilter];
      return o.category === OFFER_CATEGORIES.HOME && o.bandwidth === speedFilter;
    });
  }, [pkgQuery, speedFilter, publishedNames]);

  // Group the visible offers under their add-on flavour, keeping FLAVOURS order.
  const groupedOffers = useMemo(() => {
    const groups = new Map<string, typeof DEALER_OFFERS>();
    for (const o of filteredOffers) {
      const key = offerFlavour(o.name);
      const list = groups.get(key);
      if (list) list.push(o);
      else groups.set(key, [o]);
    }
    return FLAVOURS.filter((f) => groups.has(f)).map((f) => [f, groups.get(f)!] as const);
  }, [filteredOffers]);

  const sellableCount = publishedNames === null
    ? DEALER_OFFERS.length
    : DEALER_OFFERS.filter((o) => publishedNames.has(o.name)).length;

  // Counts per speed chip, so the agent sees where the packages actually are.
  // Counted over the SELLABLE plans, not the whole catalogue — a chip promising
  // 13 packages that then shows none is worse than no chip at all.
  const speedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const sellable = publishedNames === null
      ? DEALER_OFFERS
      : DEALER_OFFERS.filter((o) => publishedNames.has(o.name));
    for (const o of sellable) {
      const key =
        o.category === OFFER_CATEGORIES.BIZ ? "BIZ" : o.category === OFFER_CATEGORIES.VOF ? "VOF" : o.bandwidth;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [publishedNames]);

  // Device picker only applies to "with device" bundles (the portal shows the
  // device/add-on tree after such a package). Clearing the package clears it.
  const isWithDevice = /with\s*device/i.test(offerName);

  // Load what an admin recorded for this plan whenever the package changes.
  useEffect(() => {
    if (!offerName) return;
    let active = true;
    getPlanOffer(offerName)
      .then((r) => {
        if (!active) return;
        setPlanOffer({ offer: offerName, ...r });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [offerName]);

  // Only apply what was fetched for the package currently selected.
  const recorded = planOffer.offer === offerName ? planOffer : null;
  // With anything recorded for this plan, the recorded DEVICE rows are the whole
  // list — including when there are none. A plan whose only recorded group is a
  // channel offers no device to pick, and falling back to the catalogue there
  // would put 126 devices this plan never offered back in front of the agent.
  const planDevices = recorded?.known ? recorded.devices : null;
  const planChannels = recorded?.channels ?? [];
  const planDiscounts = recorded?.discounts ?? [];
  // A "With Device" plan with a recorded, EMPTY device list must stay saveable.
  const mustPickDevice = deviceRequired(isWithDevice, {
    devices: recorded?.devices ?? [],
    known: recorded?.known ?? false,
  });
  // Show the picker only when there is something to pick. Channels and
  // discounts are shown beside it, read-only: the portal ticks them itself, and
  // listing "Netflix Basic (Unifi)" among the models is what let an agent write
  // a channel bundle into the order's device.
  const showDevicePicker = isWithDevice && (planDevices === null || planDevices.length > 0);
  const showIncluded = planChannels.length > 0 || planDiscounts.length > 0;

  // Device type chips count the list actually on offer: with a plan's own
  // devices recorded, the static catalogue's counts describe a different list.
  const deviceCounts = useMemo(() => {
    if (!planDevices) return DEVICE_CATEGORY_COUNTS as Record<string, number>;
    const counts: Record<string, number> = {};
    for (const d of planDevices) {
      const c = deviceCategory(d.name);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }, [planDevices]);


  // Same treatment as packages: narrow by category, then collapse repeated
  // models under one header so only the varying part shows per row.
  //
  // When the portal's real list is known it REPLACES the catalogue: the two hold
  // different offers, and picking a catalogue device the package never offered
  // is what the portal refuses with "can't be subscribed through Contactless
  // Journey". The catalogue's category chips don't apply to that list.
  // When an admin has recorded this plan's devices, those REPLACE the static
  // catalogue: the catalogue is a different list (the portal's VAS tree) and
  // holds devices this plan never offered. Type/model grouping still applies —
  // the type is derived from the name, exactly as for catalogue entries.
  const filteredDevices = useMemo(() => {
    const q = devQuery.trim().toLowerCase();
    const source = planDevices
      ? planDevices.map((d) => ({ code: d.code ?? d.id, name: d.name, monthly: d.monthly }))
      : DEALER_DEVICES;
    return source.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q)) return false;
      return !devCategory || deviceCategory(d.name) === devCategory;
    });
  }, [devQuery, devCategory, planDevices]);
  const deviceGroups = useMemo(() => groupDevices(filteredDevices), [filteredDevices]);

  // Close the package dropdown when clicking anywhere outside it.
  useEffect(() => {
    if (!pkgOpen) return;
    function onDown(e: MouseEvent) {
      if (pkgRef.current && !pkgRef.current.contains(e.target as Node)) setPkgOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pkgOpen]);

  // Close the device dropdown when clicking outside it.
  useEffect(() => {
    if (!devOpen) return;
    function onDown(e: MouseEvent) {
      if (devRef.current && !devRef.current.contains(e.target as Node)) setDevOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [devOpen]);

  // Load an existing draft for editing. setState runs in the async callback
  // (not synchronously in the effect), so it doesn't cascade renders.
  useEffect(() => {
    if (!editingId) return;
    let active = true;
    getOrder(editingId).then((res) => {
      if (!active) return;
      if (res.success && res.data) {
        const o = res.data;
        setIdType((o.idType as IdType) || "MyKad");
        setIdNumber(o.idNumber || "");
        setIdExpiry(o.idExpiry || "");
        setFullName(o.fullName || "");
        setGender(o.gender || "");
        setBirthday(o.birthday || "");
        setRace(o.race || "");
        setMobilePrefix(o.mobilePrefix || "60");
        setMobile(o.mobile || "");
        setEmail(o.email || "");
        setPostcode(o.postcode || "");
        setStateVal(o.state || "");
        setCity(o.city || "");
        setStreet(o.street || "");
        setAddressId(o.addressId || "");
        setAddressFull(o.addressFull || "");
        setServiceCategory(o.serviceCategory || "");
        setOfferName(o.offerName || "");
        setOfferCategory(o.offerCategory || "");
        setDeviceCode(o.deviceCode || "");
        setDeviceName(o.deviceName || "");
        setRemarks(o.remarks || "");
        // A draft written before this field existed has no lead time, and it
        // submits with the default — so show the default rather than a blank
        // box the agent would have to guess at.
        setLeadHours(String(leadHoursOrDefault(o.appointmentLeadHours as number | null)));
        // Only keep documents that carry a namespaced key (servable via the
        // authenticated proxy); drop any legacy public-URL entries.
        const docs = Array.isArray(o.documents)
          ? (o.documents as unknown as OrderDocument[]).filter((d) => d && typeof d.key === "string" && d.key.startsWith("orders/"))
          : [];
        setDocuments(docs);
        setDraftId(o.id);
      } else {
        toast.error(res.error ?? "Couldn't load that draft.");
      }
      setLoadingDraft(false);
    });
    return () => {
      active = false;
    };
  }, [editingId]);

  function handlePrefixChange(v: string) {
    const digits = v.replace(/\D/g, "");
    if (digits.length > 2) {
      // Overflow past the 2-digit country code flows into the number field.
      setMobilePrefix(digits.slice(0, 2));
      setMobile((digits.slice(2) + mobile).replace(/\D/g, "").slice(0, 15));
      mobileRef.current?.focus();
    } else {
      setMobilePrefix(digits);
    }
  }

  // Postcode -> auto-detect city + state (Google geocode); agent types the street.
  async function handlePostcode(v: string) {
    const pc = v.replace(/\D/g, "").slice(0, 5);
    setPostcode(pc);
    if (pc.length === 5) {
      setDetecting(true);
      const r = await lookupPostcode(pc);
      setDetecting(false);
      if (r.success) {
        if (r.state) setStateVal(r.state);
        if (r.city) setCity(r.city.toUpperCase());
        // Some postcodes (e.g. 42610) geocode to a state but no city — tell the
        // agent to fill whatever autodetect couldn't, rather than silently
        // leaving a required field blank.
        if (!r.state || !r.city) {
          toast.warning(
            `Auto-detected ${[r.state && "state", r.city && "city"].filter(Boolean).join(" + ") || "nothing"}. Fill the rest manually.`
          );
        }
      } else {
        toast.error(r.error ?? "Couldn't auto-detect city/state — enter them manually.");
      }
    }
  }

  // `type` is explicit rather than read from the `docType` select: the Identity
  // card has no select — it always uploads the ID copy for the chosen ID Type —
  // and the Supporting card passes whatever the select says.
  async function addDoc(file: File | undefined, type: string, side?: "front" | "back") {
    if (!file) return;
    if (!idNumber.trim()) {
      toast.error("Enter the ID number before uploading documents.");
      return;
    }
    if (type === "other" && !otherLabel.trim()) {
      toast.error('Enter a document type name for "Other".');
      return;
    }
    if (documents.length >= MAX_DOCS) {
      toast.error(`Up to ${MAX_DOCS} files only.`);
      return;
    }
    const seq = documents.filter((d) => d.type === type).length + 1;
    setUploading(true);
    const fd = new FormData();
    if (side) fd.append("side", side);
    fd.append("file", file);
    fd.append("idNumber", idNumber);
    fd.append("idType", idType);
    fd.append("docType", type);
    if (type === "other") fd.append("otherLabel", otherLabel.trim());
    fd.append("seq", String(seq));
    // try/finally, not a bare await: `uploading` disables the drop zone with
    // pointer-events-none, and a Server Action THROWS on a transport failure
    // rather than returning {success:false}. One thrown call used to leave the
    // uploader greyed out and unresponsive for the rest of the session, with
    // nothing on screen to say why — a page reload was the only way out.
    try {
      const res = await uploadOrderDocument(fd);
      if (res.success) {
        setDocuments((d) => [...d, { type: res.type, url: res.url, key: res.key, filename: res.filename }]);
        toast.success("Document uploaded.");
      } else {
        toast.error(res.error ?? "Upload failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? `Upload failed: ${e.message}` : "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  // Drag-and-drop: upload dropped files one at a time (respects MAX_DOCS).
  async function addDocs(files: FileList | File[], type: string) {
    for (const f of Array.from(files)) {
      if (documents.length >= MAX_DOCS) break;
      await addDoc(f, type);
    }
  }

  // Reordering acts on the SUPPORTING rows the agent can see, then writes the
  // result back into the single `documents` list the order actually stores —
  // the identity documents keep their places untouched.
  function moveSupporting(index: number, delta: -1 | 1) {
    const reordered = moveDoc(supportingDocs, index, delta);
    setDocuments((docs) => {
      const identity = docs.filter((d) => IDENTITY_DOC_TYPES.includes(d.type as never));
      return [...identity, ...reordered];
    });
  }

  /**
   * Merge EVERY supporting document into one PDF, attach it, and drop the files
   * it replaced so exactly one is left.
   *
   * The order in which those happen is the whole safety of this: the sources are
   * removed only AFTER the combined file has uploaded, so a failed merge or a
   * failed upload leaves the order exactly as it was. Nothing here deletes from
   * R2 — the originals remain, they simply stop being attached.
   */
  async function handleCombine() {
    const chosen = [...supportingDocs];
    if (!canCombine(chosen) || combining) return;

    setCombining(true);
    try {
      const sources: { label: string; bytes: Uint8Array }[] = [];
      const unreadable: string[] = [];

      for (const doc of chosen) {
        try {
          const res = await fetch(doc.url);
          if (!res.ok) throw new Error(String(res.status));
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (isImageDocument(doc.filename)) {
            // Images become a page of their own. Normalizing through the canvas
            // first is what lets a BMP or WEBP take part at all — pdf-lib embeds
            // only PNG and JPEG, and an unembeddable source would be dropped.
            const png = await imageBytesToPng(bytes, contentTypeFor(doc.filename));
            sources.push({ label: mergeLabel(doc), bytes: await pngToPdfPage(png) });
          } else {
            sources.push({ label: mergeLabel(doc), bytes });
          }
        } catch {
          unreadable.push(mergeLabel(doc));
        }
      }

      if (sources.length === 0) {
        toast.error("None of the documents could be read — nothing was changed.");
        return;
      }

      const merged = await mergePdfs(sources);
      // mergePdfs reports what it could not parse; the fetch loop reports what it
      // could not read. Both are named, because a combined file quietly missing a
      // page looks exactly like a combine that worked.
      const skipped = [...unreadable, ...merged.failed];

      const seq = documents.filter((d) => d.type === COMBINED_DOC_TYPE).length + 1;
      const file = new File([merged.bytes as unknown as BlobPart], `combined_${seq}.pdf`, {
        type: "application/pdf",
      });
      const fd = new FormData();
      fd.append("file", file);
      fd.append("idNumber", idNumber);
      fd.append("idType", idType);
      fd.append("docType", COMBINED_DOC_TYPE);
      fd.append("otherLabel", COMBINED_DOC_LABEL);
      fd.append("seq", String(seq));

      const res = await uploadOrderDocument(fd);
      if (!res.success) {
        toast.error(res.error ?? "The combined PDF could not be attached — nothing was changed.");
        return;
      }

      // Only the documents that actually made it into the PDF are replaced. One
      // that could not be read is still on the order, because its pages are not
      // in the combined file and removing it would lose it for nothing.
      const skippedSet = new Set(skipped);
      const replaced = chosen.filter((d) => !skippedSet.has(mergeLabel(d))).map((d) => d.key);
      const combined = { type: res.type, url: res.url, key: res.key, filename: res.filename };

      setCollapsingKeys(replaced);
      // Let the collapse play before the rows leave the tree — removing them in
      // the same frame would swap the list with no animation at all.
      await new Promise((r) => setTimeout(r, 260));
      setDocuments((docs) => applyCombine(docs, replaced, combined));
      setCollapsingKeys([]);
      setArrivedKey(res.key);
      setTimeout(() => setArrivedKey((k) => (k === res.key ? null : k)), 900);

      if (skipped.length > 0) {
        toast.warning(
          `Combined ${merged.pageCount} pages. Could not read ${skipped.join(", ")} — left attached.`,
        );
      } else {
        toast.success(`Combined ${replaced.length} documents into one ${merged.pageCount}-page PDF.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? `Combine failed: ${e.message}` : "Combine failed. Try again.");
    } finally {
      setCombining(false);
    }
  }

  function handleNameBlur() {
    if (fullName && !race) setRace(inferRace(fullName));
  }

  /**
   * The address is the single source of truth: postcode / state / city are
   * derived from it as the agent types (still editable below, if the parse
   * gets one wrong). Editing it also invalidates an old draft's Confirm-era
   * addressId — otherwise the submit would select a unit the agent has since
   * typed away from.
   */
  function handleStreetChange(value: string) {
    const next = value.toUpperCase();
    setStreet(next);
    if (addrError) setAddrError("");
    if (addressId && next !== addressFull.toUpperCase()) {
      setAddressId("");
      setAddressFull("");
      setServiceCategory("");
    }
    const parts = parseMalaysianAddress(next);
    if (parts.postcode) setPostcode(parts.postcode);
    if (parts.state) setStateVal(parts.state);
    if (parts.city) setCity(parts.city.toUpperCase());
  }

  // The sentence under the lead-time box, from the same validator the save
  // uses — so the form cannot describe a lead time it would then refuse.
  const leadCheck = validateLeadHours(leadHours);
  const leadPreview = leadCheck.ok ? describeLeadTime(leadCheck.leadHours) : leadCheck.error;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (isMykadLike && !isCompleteMykad(idNumber)) {
      toast.error("MyKad must be 12 digits.");
      return;
    }
    if (!email.trim()) {
      toast.error("Email address is required.");
      return;
    }
    if (!emailValid) {
      toast.error("Enter a valid email address.");
      return;
    }
    // The address is required — an empty or half-typed one is what makes the
    // portal reject the customer profile as "data incomplete", so block it here.
    const addrCheck = validateMalaysianAddress(street);
    if (!addrCheck.ok) {
      setAddrError(addrCheck.reason);
      toast.error(addrCheck.reason);
      return;
    }
    if (!/^\d{5}$/.test(postcode.trim())) {
      toast.error("Enter a valid 5-digit postcode.");
      return;
    }
    if (!stateVal) {
      toast.error("Select a state.");
      return;
    }
    if (!city.trim()) {
      toast.error("Enter the city.");
      return;
    }
    // "with Device" packages require a device — the portal blocks the order
    // ("select one offer in the Smart Device group") without one.
    if (mustPickDevice && !deviceCode) {
      toast.error("This package includes a device — pick a device.");
      return;
    }
    // The ID copy is required. saveOrder refuses it too — this check only saves
    // the agent a round trip and names the card rather than the field path.
    if (!hasIdentityDoc) {
      toast.error(`Attach a copy of the customer's ${idDocLabel} before saving.`);
      return;
    }
    // Supporting documents are required too. saveOrder refuses it as well —
    // this check names the card rather than a zod path.
    if (!hasSupportingDoc) {
      toast.error("Attach at least one supporting document before saving.");
      return;
    }
    const lead = validateLeadHours(leadHours);
    if (!lead.ok) {
      toast.error(lead.error);
      return;
    }
    setSaving(true);
    const result = await saveOrder({
      id: draftId ?? undefined,
      idType,
      idNumber,
      idExpiry,
      fullName,
      gender,
      birthday,
      race,
      mobilePrefix,
      mobile,
      email,
      street,
      postcode,
      city,
      state: stateVal,
      addressId,
      addressFull,
      serviceCategory,
      offerCategory,
      offerName,
      deviceCode: isWithDevice ? deviceCode : "",
      deviceName: isWithDevice ? deviceName : "",
      remarks,
      appointmentLeadHours: lead.leadHours,
      documents,
    });
    setSaving(false);
    if (result.success) {
      // Remember the id so a follow-up save updates this draft instead of
      // creating a duplicate.
      setDraftId(result.id);
      toast.success(draftId ? "Draft updated." : "Order draft saved.");
      onSaved?.();
    } else {
      toast.error(result.error ?? "Failed to save order");
    }
  }

  if (loadingDraft) {
    return (
      <div className="bg-white rounded-lg border border-[#E3E8EF] p-12 flex flex-col items-center gap-3">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
        <p className="text-sm text-[#697386]">Loading draft…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-5 stagger-children [&>*]:animate-fade-in-up">
      {editingId && onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#635BFF] hover:text-[#0A2540] transition-colors"
        >
          <span aria-hidden>←</span> Back to drafts
        </button>
      )}

      {/* Customer */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className={headCls}>Customer</div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className={labelCls}>ID Type</Label>
            <select value={idType} onChange={(e) => handleIdTypeChange(e.target.value as IdType)} className={selectCls}>
              {ID_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className={labelCls}>
              ID Number <span className="text-[#DF1B41]">*</span>{" "}
              {isMykadLike && (
                <span className="text-[#697386] font-normal tabular-nums">
                  ({idNumber.length}/12)
                </span>
              )}
            </Label>
            <Input
              value={isMykadLike ? formatMykad(idNumber) : idNumber}
              onChange={(e) => handleIdNumberChange(e.target.value)}
              required
              aria-invalid={idNumberIncomplete}
              className={`${inputCls} uppercase tabular-nums ${idNumberIncomplete ? "border-[#DF1B41] focus:border-[#DF1B41]" : ""}`}
              placeholder={isMykadLike ? "XXXXXX-XX-XXXX" : "ID / Passport number"}
              inputMode={isMykadLike ? "numeric" : "text"}
              autoComplete="off"
            />
            {idNumberIncomplete && (
              <p className="flex items-center gap-1.5 text-[11px] text-[#DF1B41]">
                <WarnIcon />
                <span>MyKad must be 12 digits — {12 - idNumber.length} more to go.</span>
              </p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className={labelCls}>Full Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value.toUpperCase())} onBlur={handleNameBlur} required className={`${inputCls} uppercase`} placeholder="AS PER ID" />
          </div>
          <div className="space-y-1.5">
            <Label className={labelCls}>Gender {isMykadLike && <span className="text-[#697386]">(auto)</span>}</Label>
            <select value={gender} onChange={(e) => setGender(e.target.value)} className={selectCls}>
              <option value="">---</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className={labelCls}>Birthday {isMykadLike && <span className="text-[#697386]">(auto)</span>}</Label>
            <Input value={birthday} onChange={(e) => setBirthday(e.target.value)} className={inputCls} placeholder="dd-mm-yyyy" />
          </div>
          <div className="space-y-1.5">
            <Label className={labelCls}>Race</Label>
            <select value={race} onChange={(e) => setRace(e.target.value)} className={selectCls}>
              <option value="">---</option>
              <option value="Malay">Malay</option>
              <option value="Chinese">Chinese</option>
              <option value="Indian">Indian</option>
              <option value="Others">Others</option>
            </select>
          </div>
          {!isMykadLike && (
            <div className="space-y-1.5">
              <Label className={labelCls}>ID Expiry Date</Label>
              <Input value={idExpiry} onChange={(e) => setIdExpiry(e.target.value)} className={inputCls} placeholder="dd-mm-yyyy" />
            </div>
          )}
        </div>
      </div>

      {/* Contact */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className={headCls}>Contact</div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className={labelCls}>Handphone</Label>
            <div className="flex gap-2">
              <div className={`flex items-center gap-1 px-3 h-10 rounded-lg border bg-[#F6F9FC] text-sm text-[#425466] ${mobilePrefix.startsWith("0") ? "border-[#DF1B41]" : "border-[#E3E8EF]"}`}>
                <span>+</span>
                <input value={mobilePrefix} onChange={(e) => handlePrefixChange(e.target.value)} className="w-8 bg-transparent focus:outline-none" inputMode="numeric" aria-label="Country code" />
              </div>
              {/* Strip a leading 0 — with a country code the national number has no trunk 0 (012… → 12…). */}
              <Input ref={mobileRef} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").replace(/^0+/, ""))} className={`flex-1 ${inputCls}`} placeholder="123456789" inputMode="numeric" />
            </div>
            {mobilePrefix.startsWith("0") ? (
              <p className="text-[11px] text-[#DF1B41]">That looks like a trunk prefix. Use the country code (e.g. 60 for Malaysia).</p>
            ) : (
              <p className="text-[11px] text-[#697386]">Country code (e.g. 60), then the number without the leading 0.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className={labelCls}>Email Address <span className="text-[#DF1B41]">*</span></Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
              required
              autoComplete="email"
              aria-invalid={email.length > 0 && !emailValid}
              className={`${inputCls} ${email.length > 0 && !emailValid ? "border-[#DF1B41] focus:border-[#DF1B41]" : ""}`}
              placeholder="name@example.com"
            />
            {email.length > 0 && !emailValid && (
              <p className="flex items-center gap-1.5 text-[11px] text-[#DF1B41]">
                <WarnIcon />
                <span>That email address isn&apos;t valid.</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Installation Address — ONE card, ONE field: the agent pastes the
          complete address exactly as the Unifi portal renders it. No Confirm
          step: the submit run drives the portal with this text as-is, so its
          accuracy is entirely the agent's responsibility. */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className={headCls}>
          Installation Address <span className="text-[#697386] font-normal">— paste the full address from the Unifi portal</span>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <Label className={labelCls}>
              Full Address <span className="text-[#DF1B41]">*</span>
            </Label>
            <Input
              value={street}
              onChange={(e) => handleStreetChange(e.target.value)}
              className={`${inputCls} uppercase`}
              placeholder="A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7 BANDAR SAUJANA PUTRA JENJAROM SELANGOR MALAYSIA 42610"
            />

            {/* Guidance: what "full address" means, in the order the portal
                writes it, with the parts named so the agent can self-check. */}
            <div className="rounded-lg border border-[#E3E8EF] bg-[#F6F9FC] px-3 py-2.5 space-y-1.5">
              <p className="text-[11px] text-[#0A2540]">
                <span className="font-medium">Copy the address exactly as the Unifi portal shows it — you are fully responsible for its accuracy.</span>{" "}
                It is not checked against the portal here: the order is submitted with this address as-is, and a wrong or
                unserviceable one fails at submit time.
              </p>
              <p className="text-[11px] text-[#697386]">
                Order of parts:{" "}
                <span className="text-[#0A2540]">unit</span> · <span className="text-[#0A2540]">street</span> ·{" "}
                <span className="text-[#0A2540]">area</span> · <span className="text-[#0A2540]">city</span> ·{" "}
                <span className="text-[#0A2540]">state</span> · <span className="text-[#0A2540]">MALAYSIA</span> ·{" "}
                <span className="text-[#0A2540]">postcode</span>
              </p>
              <p className="text-[11px] text-[#697386]">
                Example:{" "}
                <code className="rounded bg-white px-1.5 py-0.5 text-[10px] text-[#0A2540] border border-[#E3E8EF]">
                  A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7 BANDAR SAUJANA PUTRA JENJAROM SELANGOR MALAYSIA 42610
                </code>
              </p>
            </div>
            {addrError && (
              <p className="flex items-start gap-1.5 text-[11px] text-[#DF1B41]" role="alert">
                <svg viewBox="0 0 24 24" className="mt-px h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
                </svg>
                <span>{addrError}</span>
              </p>
            )}
          </div>

          {/* Derived from the address above as the agent types — always
              editable so they can correct what was derived. */}
          <div className="border-t border-[#F0F3F8] pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <AutoIcon />
              <span className="text-[11px] font-medium text-[#0A2540]">Extracted from the address above</span>
              <span className="text-[11px] text-[#697386]">— check these, edit if the portal disagrees</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className={labelCls}>
                  Postcode <span className="text-[#DF1B41]">*</span>{" "}
                  {detecting && <span className="text-[#697386] font-normal">(detecting…)</span>}
                </Label>
                <Input
                  value={postcode}
                  onChange={(e) => handlePostcode(e.target.value)}
                  className={inputCls}
                  placeholder="40150"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label className={labelCls}>
                  State <span className="text-[#DF1B41]">*</span>
                </Label>
                <select
                  value={stateVal}
                  onChange={(e) => setStateVal(e.target.value)}
                  className={selectCls}
                >
                  <option value="">---</option>
                  {MALAYSIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className={labelCls}>
                  City <span className="text-[#DF1B41]">*</span>
                </Label>
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value.toUpperCase())}
                  className={`${inputCls} uppercase`}
                  placeholder="SHAH ALAM"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Package — card NOT clipped so the dropdown shows fully.
          `relative z-30` is load-bearing: the entrance animation leaves every
          card with a retained transform (fill-mode: both resolves even
          `transform: none` to an identity matrix), which makes each card its
          own stacking context. Without an explicit z-index the later Device /
          Documents cards would paint over this card's open dropdown. Package
          must also outrank Device, whose own dropdown sits below it. */}
      <div className={`${cardCls} relative z-30`}>
        <div className={headCls}>
          Package <span className="text-[#697386] font-normal">— pick the speed, then the bundle</span>
        </div>
        <div className="p-6 space-y-3">
          {/* Speed first: it's what the customer actually asked for, and it cuts
              60 offers down to at most 18. */}
          <div className="space-y-1.5">
            <Label className={labelCls}>Speed</Label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSpeedFilter("")}
                aria-pressed={speedFilter === ""}
                className={`h-8 rounded-full px-3 text-[12px] font-medium cursor-pointer transition-colors duration-200 border ${
                  speedFilter === ""
                    ? "bg-[#0A2540] text-white border-[#0A2540]"
                    : "bg-white text-[#425466] border-[#E3E8EF] hover:border-[#635BFF] hover:text-[#0A2540]"
                }`}
              >
                All <span className="tabular-nums opacity-70">{sellableCount}</span>
              </button>
              {SPEED_CHIPS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeedFilter(speedFilter === s ? "" : s)}
                  aria-pressed={speedFilter === s}
                  className={`h-8 rounded-full px-3 text-[12px] font-medium cursor-pointer transition-colors duration-200 border ${
                    speedFilter === s
                      ? "bg-[#0A2540] text-white border-[#0A2540]"
                      : "bg-white text-[#425466] border-[#E3E8EF] hover:border-[#635BFF] hover:text-[#0A2540]"
                  }`}
                >
                  {SPEED_LABELS[s]} <span className="tabular-nums opacity-70">{speedCounts[s] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className={labelCls}>Main Offer</Label>
            <div className="relative" ref={pkgRef}>
              <Input
                value={pkgQuery || offerName}
                onChange={(e) => { setPkgQuery(e.target.value); setPkgOpen(true); setOfferName(""); }}
                onFocus={() => setPkgOpen(true)}
                className={inputCls}
                placeholder={speedFilter ? `Search ${SPEED_LABELS[speedFilter]} packages…` : "Search all packages, or pick a speed above"}
              />
              {pkgOpen && (
                <div className="absolute z-20 mt-1 w-full max-h-80 overflow-auto rounded-lg border border-[#E3E8EF] bg-white shadow-lg py-1 animate-fade-in">
                  {groupedOffers.length === 0 && (
                    <div className="px-3 py-3 text-xs text-[#697386]">
                      No package matches{pkgQuery && ` “${pkgQuery}”`}
                      {speedFilter && ` in ${SPEED_LABELS[speedFilter]}`}.
                      {speedFilter && " Try the All chip to search every speed."}
                    </div>
                  )}
                  {groupedOffers.map(([flavour, offers]) => (
                    <div key={flavour}>
                      <div className="sticky top-0 z-10 flex items-center justify-between bg-[#F6F9FC] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#697386] border-y border-[#E3E8EF]">
                        <span>{flavour}</span>
                        <span className="tabular-nums">{offers.length}</span>
                      </div>
                      {offers.map((o) => (
                        <button
                          key={o.name}
                          type="button"
                          onClick={() => { setOfferName(o.name); setOfferCategory(o.category); setPkgQuery(""); setPkgOpen(false); }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-[#0A2540] cursor-pointer transition-colors duration-200 hover:bg-[#F6F9FC] focus:bg-[#F6F9FC] focus:outline-none"
                        >
                          <span>{o.name}</span>
                          <span className="ml-3 shrink-0 text-[11px] text-[#697386] tabular-nums">{o.bandwidth}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {offerName && (
            <p className="flex items-center gap-1.5 text-[11px] text-green-700">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span>Selected: {offerName}{mustPickDevice && " — pick the device below"}</span>
            </p>
          )}
        </div>
      </div>

      {/* Device — for "with device" bundles, and for any plan that carries
          something the portal applies by itself (a channel bundle, a discount).
          Ranks above the later cards for its own dropdown, below Package. */}
      {(isWithDevice || showIncluded) && (
        <div className={`${cardCls} relative z-20`}>
          <div className={headCls}>
            Device{" "}
            <span className="text-[#697386] font-normal">
              {showDevicePicker ? "— pick the type, then the model" : "— what this plan carries"}
            </span>
          </div>
          <div className="p-6 space-y-3">
            {isWithDevice && !showDevicePicker && (
              <p className="text-[12px] text-[#425466]">
                This plan has no device to pick — everything it carries is applied by the portal
                itself and listed below.
              </p>
            )}
            {showDevicePicker && (<>
            {/* Category first — the catalog mixes tablets, TVs, Smart Home kit
                and pure line items (Stamp Duty, Promo Discount) in one list. */}
            <div className="space-y-1.5">
              <Label className={labelCls}>Type</Label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setDevCategory("")}
                  aria-pressed={devCategory === ""}
                  className={`h-8 rounded-full px-3 text-[12px] font-medium cursor-pointer transition-colors duration-200 border ${
                    devCategory === ""
                      ? "bg-[#0A2540] text-white border-[#0A2540]"
                      : "bg-white text-[#425466] border-[#E3E8EF] hover:border-[#635BFF] hover:text-[#0A2540]"
                  }`}
                >
                  All <span className="tabular-nums opacity-70">{planDevices?.length ?? DEALER_DEVICES.length}</span>
                </button>
                {DEVICE_CATEGORIES.filter((c) => deviceCounts[c]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setDevCategory(devCategory === c ? "" : c)}
                    aria-pressed={devCategory === c}
                    className={`h-8 rounded-full px-3 text-[12px] font-medium cursor-pointer transition-colors duration-200 border ${
                      devCategory === c
                        ? "bg-[#0A2540] text-white border-[#0A2540]"
                        : "bg-white text-[#425466] border-[#E3E8EF] hover:border-[#635BFF] hover:text-[#0A2540]"
                    }`}
                  >
                    {c} <span className="tabular-nums opacity-70">{deviceCounts[c]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className={labelCls}>
                Device{mustPickDevice && <span className="text-[#DF1B41]"> *</span>}
              </Label>
              {/* Say which list is on screen: the catalogue is a DIFFERENT set of
                  offers from what a plan actually allows, so picking from it is a
                  guess until an admin has recorded the plan's real devices. */}
              {planDevices ? (
                <p className="flex items-start gap-1.5 text-[11px] text-green-700">
                  <svg viewBox="0 0 24 24" className="mt-0.5 h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span>
                    Showing the {planDevices.length} device
                    {planDevices.length === 1 ? "" : "s"} this plan offers.
                  </span>
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
                  <WarnIcon />
                  <span>
                    Showing the full catalogue — no devices recorded for this plan yet, so
                    not everything here can be ordered with it.
                  </span>
                </p>
              )}
              <div className="relative" ref={devRef}>
                <Input
                  value={devQuery || deviceName}
                  onChange={(e) => { setDevQuery(e.target.value); setDevOpen(true); setDeviceName(""); setDeviceCode(""); }}
                  onFocus={() => setDevOpen(true)}
                  className={inputCls}
                  placeholder={devCategory ? `Search ${devCategory}…` : "Search all devices, or pick a type above"}
                />
                {devOpen && (
                  <div className="absolute z-20 mt-1 w-full max-h-80 overflow-auto rounded-lg border border-[#E3E8EF] bg-white shadow-lg py-1 animate-fade-in">
                    {deviceGroups.length === 0 && (
                      <div className="px-3 py-3 text-xs text-[#697386]">
                        No device matches{devQuery && ` “${devQuery}”`}
                        {devCategory && ` in ${devCategory}`}.
                        {devCategory && " Try the All chip to search every type."}
                      </div>
                    )}
                    {deviceGroups.map((g) => (
                      <div key={g.header}>
                        <div className="sticky top-0 z-10 flex items-center justify-between bg-[#F6F9FC] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#697386] border-y border-[#E3E8EF]">
                          <span className="truncate">{g.header}</span>
                          <span className="tabular-nums shrink-0 pl-2">{g.items.length}</span>
                        </div>
                        {g.items.map((d) => {
                          // Inside a model group only the varying part is worth
                          // reading — the model is already the header.
                          const { variant } = deviceFamily(d.name);
                          const label = g.singles ? d.name : variantLabel(variant, d.monthly) || d.name;
                          return (
                            <button
                              key={d.code}
                              type="button"
                              onClick={() => { setDeviceName(d.name); setDeviceCode(d.code); setDevQuery(""); setDevOpen(false); }}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-[#0A2540] cursor-pointer transition-colors duration-200 hover:bg-[#F6F9FC] focus:bg-[#F6F9FC] focus:outline-none"
                            >
                              <span className="truncate">
                                {label}
                                {/* Some catalog names repeat verbatim and differ
                                    only by portal code — show it so the pick is
                                    explicit rather than a coin flip. */}
                                {isAmbiguousDevice(d.name) && (
                                  <span className="ml-2 text-[10px] text-[#697386] tabular-nums">#{d.code}</span>
                                )}
                              </span>
                              {d.monthly !== null && (
                                <span className="ml-3 shrink-0 text-[11px] text-[#697386] tabular-nums">
                                  RM{d.monthly}/mth
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {deviceName && (
              <p className="flex items-center gap-1.5 text-[11px] text-green-700">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span>Selected: {deviceName}{isAmbiguousDevice(deviceName) && ` (#${deviceCode})`}</span>
              </p>
            )}
            </>)}
            {/* Channels and discounts are applied during the order, not chosen
                here — shown so the agent can tell the customer what they get,
                without being able to order one in place of the device. */}
            {showIncluded && (
              <div className="rounded-lg border border-[#E3E8EF] bg-[#F6F9FC] px-3 py-2">
                <p className="text-[11px] font-medium text-[#425466]">Included with this plan</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {planChannels.map((c) => (
                    <li key={c.id} className="text-[11px] text-[#697386]">
                      <div className="flex items-center gap-2">
                        <span className="text-[#8792A2]">•</span>
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        {c.monthly !== null && (
                          <span className="shrink-0 tabular-nums">RM{c.monthly}/mth</span>
                        )}
                      </div>
                      {c.options.length > 0 && (
                        <div className="ml-4 mt-0.5 text-[10px] text-[#8792A2]">
                          {(() => {
                            const inc = c.options.find((o) => o.included);
                            const rest = c.options.filter((o) => !o.included);
                            return (
                              <>
                                {inc && <span className="text-[#425466]">{inc.name} included</span>}
                                {inc && rest.length > 0 && " · "}
                                {rest.length > 0 && (
                                  <span>
                                    upgrades in the portal:{" "}
                                    {rest
                                      .map((o) => `${o.name}${o.monthly ? ` (RM${o.monthly}/mth)` : ""}`)
                                      .join(", ")}
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </li>
                  ))}
                  {planDiscounts.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-[11px] text-[#697386]">
                      <span className="text-[#8792A2]">•</span>
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                      {d.monthly !== null && (
                        <span className="shrink-0 tabular-nums">RM{d.monthly}/mth</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Appointment ────────────────────────────────────────────────────────
          Set per order by the agent who knows the customer. It used to be one
          global setting an admin kept for everyone, which meant a customer who
          could take a slot tomorrow waited as long as one who could not. */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className={headCls}>
          Appointment{" "}
          <span className="text-[#697386] font-normal">— how soon the install may be booked</span>
        </div>
        <div className="p-6 space-y-3">
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="lead-hours" className={labelCls}>
              Earliest slot, in hours from submit
            </Label>
            <Input
              id="lead-hours"
              type="number"
              inputMode="numeric"
              min={MIN_LEAD_HOURS}
              max={MAX_LEAD_HOURS}
              step={1}
              value={leadHours}
              onChange={(e) => setLeadHours(e.target.value)}
              className={inputCls}
            />
          </div>
          <p className="text-[11px] text-[#697386]">
            {leadPreview}
          </p>
          <p className="text-[11px] text-[#697386]">
            The submit takes the earliest slot the portal offers at or after that point. If the
            portal has none, the order fails rather than booking something sooner.
          </p>
        </div>
      </div>

      {/* Remarks */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className={headCls}>Additional Remarks</div>
        <div className="p-6">
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-[#CBD2DC] bg-white px-3 py-2 text-sm text-[#0A2540] hover:border-[#635BFF] focus:border-[#635BFF] focus:outline-none transition-colors resize-y"
            placeholder="Any notes for this order (optional)"
          />
        </div>
      </div>

      {/* ── Identity Document (required) ───────────────────────────────────────
          Its own card because the portal's Personal Customer form marks the ID
          copy required: a draft without one dies mid-submit with every field
          filled and nothing on screen saying which one was missing. There is no
          Type select here — the card IS the type, following the chosen ID Type. */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className={headCls}>
          {idDocLabel}
          <span className="ml-1.5 text-[#DF1B41] font-normal">*</span>
          {hasIdentityDoc && <span className="ml-2 text-[11px] font-normal text-green-700">Attached ✓</span>}
        </div>
        <div className="p-6 space-y-4">
          <p className="text-[11px] text-[#697386]">
            Required — the portal will not accept the customer profile without a copy of the
            customer&apos;s {idDocLabel}. Add both sides as two files if you have them.
            Saved as {idNumber || "{id}"}_{isMykadLike ? "mykad" : idType.toLowerCase()}_n.
          </p>

          <label
            onDragOver={(e) => { e.preventDefault(); setDragZone("identity"); }}
            onDragLeave={() => setDragZone(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragZone(null);
              if (e.dataTransfer.files?.length) addDocs(e.dataTransfer.files, idDocType);
            }}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
              dragZone === "identity"
                ? "border-[#635BFF] bg-[#635BFF]/5"
                : hasIdentityDoc
                  ? "border-[#CBD2DC] hover:border-[#635BFF]/60"
                  : "border-[#DF1B41]/50 bg-[#DF1B41]/[0.03] hover:border-[#DF1B41]"
            } ${uploading || docsFull ? "opacity-50 pointer-events-none" : ""}`}
          >
            <LottieSpot name="dropzone" size={52} className="-mb-1" fallback={null} />
            <span className="text-[13px] font-medium text-[#425466]">
              Drag &amp; drop the {idDocLabel} here, or <span className="text-[#635BFF]">browse</span>
            </span>
            <span className="text-[11px] text-[#697386]">JPG, PNG, PDF, WEBP · max 5MB each</span>
            <input
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.bmp,.pdf,.webp,.jfif"
              disabled={uploading || docsFull}
              onChange={(e) => { if (e.target.files) addDocs(e.target.files, idDocType); e.target.value = ""; }}
              className="hidden"
            />
          </label>

          {identityDocs.length > 0 && (
            <div className="space-y-1.5">
              {identityDocs.map((d) => (
                <div key={d.key} className="flex items-center justify-between rounded-lg bg-[#F6F9FC] px-3 py-2">
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-[12px] text-[#0A2540] truncate hover:text-[#635BFF]">
                    {d.filename}
                  </a>
                  <button type="button" onClick={() => setDocuments((docs) => docs.filter((x) => x.key !== d.key))} className="ml-3 shrink-0 text-[11px] text-[#DF1B41] hover:underline cursor-pointer">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {!hasIdentityDoc && (
            <p className="text-[11px] font-medium text-[#DF1B41]">
              The order cannot be saved until this is attached.
            </p>
          )}
        </div>
      </div>

      {/* ── Supporting Documents (required) ──────────────────────────────────
          There are two ways to put a document on an order and they used to sit
          stacked under one thin divider, which read as one long form rather than
          a choice — the generate row looked like a toolbar above the "real"
          upload controls. A segmented control makes it a choice and lets each
          panel own its full width. */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className={`${headCls} flex items-center justify-between`}>
          <span>
            Supporting Documents
            <span className="ml-1.5 text-[#DF1B41] font-normal">*</span>
            {hasSupportingDoc && (
              <span className="ml-2 text-[11px] font-normal text-green-700">Attached ✓</span>
            )}
          </span>
          <span className="text-[#697386] font-normal text-xs tabular-nums">
            {documents.length}/{MAX_DOCS} total
          </span>
        </div>
        <div className="p-6 space-y-5">
          {/* Same intro the ID card carries, so the two required cards read the
              same way: what the rule is, before the controls that satisfy it. */}
          <p className="text-[11px] text-[#697386]">
            Required — attach at least one document supporting this order. Upload a file, or
            generate one from the order details.
          </p>

          {/* Source picker. role=tablist so the two panels are announced as what
              they are, and so arrow keys are expected to move between them. */}
          <div
            role="tablist"
            aria-label="How to add a supporting document"
            className="inline-flex w-full max-w-md rounded-lg border border-[#E3E8EF] bg-[#F6F9FC] p-1"
          >
            {DOC_SOURCES.map((s) => {
              const active = docSource === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`doc-panel-${s.id}`}
                  id={`doc-tab-${s.id}`}
                  onClick={() => setDocSource(s.id)}
                  className={`flex-1 inline-flex items-center justify-center gap-2 min-h-10 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF] ${
                    active
                      ? "bg-white text-[#0A2540] shadow-[0_1px_2px_rgba(10,37,64,0.10)]"
                      : "text-[#697386] hover:text-[#0A2540]"
                  }`}
                >
                  {s.id === "upload" ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9.9 15.5A2 2 0 0 0 8.5 14.1l-6.1-1.6a.5.5 0 0 1 0-1L8.5 9.9A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z" /></svg>
                  )}
                  <span className="sm:hidden">{s.short}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* ── Upload panel ── */}
          {docSource === "upload" && (
            <div id="doc-panel-upload" role="tabpanel" aria-labelledby="doc-tab-upload" className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label className={labelCls} htmlFor="doc-type">Type</Label>
                  <select id="doc-type" value={docType} onChange={(e) => setDocType(e.target.value)} className={selectCls}>
                    {docTypeOptions.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
                {docType === "other" && (
                  <div className="space-y-1.5">
                    <Label className={labelCls} htmlFor="doc-name">Document Name</Label>
                    <Input
                      id="doc-name"
                      value={otherLabel}
                      onChange={(e) => setOtherLabel(e.target.value)}
                      className={inputCls}
                      placeholder="e.g. tenancy agreement"
                    />
                  </div>
                )}
                {uploading && <span className="text-[11px] text-[#697386] pb-3">Uploading…</span>}
                {!uploading && docsFull && (
                  <span className="text-[11px] text-[#697386] pb-3">
                    {MAX_DOCS} files attached — remove one to add another.
                  </span>
                )}
              </div>

              <label
                onDragOver={(e) => { e.preventDefault(); setDragZone("supporting"); }}
                onDragLeave={() => setDragZone(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragZone(null);
                  if (e.dataTransfer.files?.length) addDocs(e.dataTransfer.files, docType);
                }}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors duration-200 ${
                  dragZone === "supporting"
                    ? "border-[#635BFF] bg-[#635BFF]/5"
                    : hasSupportingDoc
                      ? "border-[#CBD2DC] hover:border-[#635BFF]/60"
                      : "border-[#DF1B41]/50 bg-[#DF1B41]/[0.03] hover:border-[#DF1B41]"
                } ${uploading || docsFull ? "opacity-50 pointer-events-none" : ""}`}
              >
                <LottieSpot name="dropzone" size={52} className="-mb-1" fallback={null} />
                <span className="text-[13px] font-medium text-[#425466]">
                  Drag &amp; drop files here, or <span className="text-[#635BFF]">browse</span>
                </span>
                <span className="text-[11px] text-[#697386]">JPG, PNG, PDF, WEBP · max 5MB each · add 2+ files for the same type</span>
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.bmp,.pdf,.webp,.jfif"
                  disabled={uploading || docsFull}
                  onChange={(e) => { if (e.target.files) addDocs(e.target.files, docType); e.target.value = ""; }}
                  className="hidden"
                />
              </label>

              <p className="text-[11px] text-[#697386]">
                Saved as {idNumber || "{id}"}_
                {docType === "utility_bill"
                  ? "utilitybill"
                  : docType === "im_conversation"
                    ? "imconversation"
                    : (otherLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "doc")}
                _n. Up to {MAX_DOCS} files in total across both cards.
              </p>
            </div>
          )}

          {/* ── Generate panel ──
              All five stay visible and disabled rather than appearing as fields
              fill: a set that silently grows leaves a document you expected
              simply absent, with nothing saying why. */}
          {docSource === "generate" && (
            <div id="doc-panel-generate" role="tabpanel" aria-labelledby="doc-tab-generate" className="space-y-3">
              {/* One click for the whole set. The count is the same eligibility
                  test each card applies, so "all 4" says up front that an
                  attached or blocked kind will be skipped rather than failing. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-[#697386]" aria-live="polite">
                  {genBatchRef.current.active && genDoc
                    ? `Generating ${genBatchRef.current.ok + genBatchRef.current.failed.length + 1} of ${genBatchRef.current.total}: ${docSpec(genDoc).label}…`
                    : generateAllTypes.length > 0
                      ? "Or generate every eligible document in one go:"
                      : "Nothing eligible to generate — each card below says why."}
                </span>
                <Button
                  type="button"
                  onClick={handleGenerateAll}
                  disabled={generateAllTypes.length === 0 || genDoc !== null}
                  className="h-9 px-3 rounded-lg text-[12px] font-semibold bg-[#635BFF] hover:bg-[#0A2540] text-white transition-colors duration-200 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                >
                  {genBatchRef.current.active && genDoc
                    ? "Generating…"
                    : generateAllTypes.length > 0
                      ? `Generate all ${generateAllTypes.length}`
                      : "Generate all"}
                </Button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {GENERATED_DOCS.map((g) => {
                  const missing = missingFieldsFor(g.type, genSource);
                  const blocked = missing.length > 0;
                  const running = genDoc === g.type;
                  // One of each kind per order, however it arrived. Removing the
                  // row makes this available again.
                  const already = isDocTypeAttached(g.type, documents);
                  return (
                    <button
                      key={g.type}
                      type="button"
                      onClick={() => setGenDoc(g.type)}
                      disabled={already || blocked || docsFull || genDoc !== null}
                      title={
                        already
                          ? `Already attached — remove it below to generate a new ${g.label.toLowerCase()}.`
                          : blocked
                            ? `Fill in ${missing.join(", ")} first.`
                            : undefined
                      }
                      aria-busy={genDoc === g.type}
                      className={`group flex items-center gap-3 h-14 px-3 rounded-lg border text-left transition-colors duration-200 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF] ${
                        already
                          // Done, not unavailable. Dimming it to 50% like the
                          // blocked cards would say the opposite of what happened.
                          ? "border-[#0E9F6E]/30 bg-[#0E9F6E]/[0.04]"
                          : "border-[#E3E8EF] bg-white hover:border-[#635BFF] hover:bg-[#635BFF]/[0.03] disabled:opacity-50 disabled:hover:border-[#E3E8EF] disabled:hover:bg-white"
                      }`}
                    >
                      <span className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-200 ${
                        already ? "bg-[#0E9F6E]/10 text-[#0E9F6E]" : "bg-[#F6F9FC] text-[#635BFF] group-hover:bg-[#635BFF]/10 group-disabled:text-[#697386]"
                      }`}>
                        {running ? (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
                        ) : already ? (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                          </svg>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-[#0A2540] truncate">{g.label}</span>
                        {/* The blocking field is named on the face of the button,
                            not only in a tooltip a keyboard user never sees. */}
                        <span className="block text-[11px] text-[#697386] truncate">
                          {running
                            ? "Generating…"
                            : already
                              ? "Attached to this order"
                              : blocked
                                ? `Needs ${missing[0]}`
                                : g.ext.toUpperCase()}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-[#697386]">
                Built from this order&apos;s own details and attached straight away — it appears in the
                list below, where you can open or remove it. Nothing here counts against your case limit.
              </p>
            </div>
          )}

          {/* ── Attached list + Combine ──
              This block is outside both panels: what is attached does not depend
              on how it got there, and hiding the list behind the Upload tab
              would make a generated file look like it had not arrived. */}
          <div className="pt-1 border-t border-[#E3E8EF]">
            {supportingDocs.length === 0 ? (
              <p className="pt-4 text-[12px] text-[#697386]">
                No supporting documents yet — most orders carry the IM conversation. Attach two or
                more and you can combine them into a single PDF.
              </p>
            ) : (
              <div className="pt-4 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                  <span className="text-xs font-medium text-[#425466]">
                    Attached <span className="text-[#697386] tabular-nums">({supportingDocs.length})</span>
                  </span>
                  <Button
                    type="button"
                    onClick={handleCombine}
                    disabled={!canCombine(supportingDocs) || combining || uploading}
                    className="h-9 px-3 rounded-lg text-[12px] font-semibold bg-[#635BFF] hover:bg-[#0A2540] text-white transition-colors duration-200 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {combining
                      ? "Combining…"
                      : canCombine(supportingDocs)
                        ? `Combine all ${supportingDocs.length} into one PDF`
                        : "Combine into one PDF"}
                  </Button>
                </div>

                {supportingDocs.map((d, i) => {
                  const leaving = collapsingKeys.includes(d.key);
                  const willMerge = combining && !leaving;
                  return (
                    <div
                      key={d.key}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 border transition-all duration-200 ${
                        willMerge
                          ? "bg-[#635BFF]/[0.06] border-[#635BFF]/40"
                          : "bg-[#F6F9FC] border-transparent"
                      } ${leaving ? "doc-collapsing" : ""} ${d.key === arrivedKey ? "doc-arriving" : ""}`}
                    >
                      {/* Every row goes in, so the accent marks "being merged"
                          rather than "selected" — it appears while a combine runs
                          and is the only thing that shows which rows are about to
                          be replaced. */}
                      <span
                        aria-hidden
                        className={`w-[3px] self-stretch rounded-full bg-[#635BFF] transition-all duration-200 ${
                          willMerge ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0"
                        }`}
                      />
                      <span className="shrink-0 text-[10px] tabular-nums text-[#697386] w-4 text-center" aria-hidden>
                        {i + 1}
                      </span>
                      <a href={d.url} target="_blank" rel="noreferrer" className="flex-1 text-[12px] text-[#0A2540] truncate hover:text-[#635BFF] transition-colors duration-200">
                        {d.filename}
                      </a>

                      {/* Order is page order in the combined PDF. Arrows rather
                          than drag — drag is unreachable from a keyboard. */}
                      <span className="flex shrink-0 items-center">
                        <button
                          type="button"
                          onClick={() => moveSupporting(i, -1)}
                          disabled={i === 0}
                          aria-label={`Move ${d.filename} up`}
                          className="p-1 rounded text-[#697386] hover:text-[#0A2540] hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors duration-200"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m18 15-6-6-6 6" /></svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSupporting(i, 1)}
                          disabled={i === supportingDocs.length - 1}
                          aria-label={`Move ${d.filename} down`}
                          className="p-1 rounded text-[#697386] hover:text-[#0A2540] hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors duration-200"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
                        </button>
                      </span>

                      <button type="button" onClick={() => setDocuments((docs) => docs.filter((x) => x.key !== d.key))} className="ml-1 shrink-0 text-[11px] text-[#DF1B41] hover:underline cursor-pointer">
                        Remove
                      </button>
                    </div>
                  );
                })}

                {/* The Combine button is present from the first attachment, so
                    the feature is learned on arrival rather than discovered by
                    accident at two files. It says what it is waiting for. */}
                <p className="pt-1 text-[11px] text-[#697386]" aria-live="polite">
                  {canCombine(supportingDocs)
                    ? "Combining replaces all of these with a single PDF, in the order shown. Use the arrows to reorder."
                    : `Attach at least ${MIN_COMBINE} documents to combine them into one PDF.`}
                </p>
              </div>
            )}
          </div>

          {!hasSupportingDoc && (
            <p className="text-[11px] font-medium text-[#DF1B41]">
              The order cannot be saved until this is attached.
            </p>
          )}
        </div>
      </div>


      {/* Sticky action bar: the primary action rides the viewport bottom, so a
          six-card form never means scrolling back down to save. The summary is
          informational — handleSubmit stays the sole validator. */}
      <div className="sticky bottom-0 z-20 -mx-1 flex items-center gap-3 rounded-t-xl border border-b-0 border-[#E3E8EF] bg-white/95 px-4 py-3 shadow-[0_-6px_16px_rgba(10,37,64,0.06)] backdrop-blur">
        <Button type="submit" disabled={saving} aria-busy={saving} className="h-10 px-6 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] hover-glow press-effect cursor-pointer transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed">
          {saving ? "Saving…" : draftId ? "Update Draft" : "Save Order"}
        </Button>
        {missingRequired.length > 0 ? (
          <span className="min-w-0 truncate text-xs text-[#697386]" aria-live="polite">
            {missingRequired.length} required field{missingRequired.length === 1 ? "" : "s"} left
            <span className="hidden sm:inline">
              {" · "}
              {missingRequired.slice(0, 3).join(", ")}
              {missingRequired.length > 3 ? "…" : ""}
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#0E9F6E]" aria-live="polite">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            All required fields filled
          </span>
        )}
      </div>

      {/* Generates and attaches, then clears itself. Mounted only while running so
          the chat's off-screen render target does not sit in the tree. */}
      {genDoc && (
        <GenerateDocRunner
          type={genDoc}
          source={genSource}
          existingOfType={documents.filter((d) => d.type === docSpec(genDoc).attachAs).length}
          onDone={({ doc, error }) => {
            // Computed here rather than read back from state: setDocuments has
            // not landed yet when the next step's eligibility is decided.
            const nextDocuments = doc ? [...documents, doc] : documents;
            if (doc) {
              setDocuments(nextDocuments);
              setArrivedKey(doc.key);
              setTimeout(() => setArrivedKey((k) => (k === doc.key ? null : k)), 900);
              toast.success(`${docSpec(genDoc).label} attached to the order.`);
            } else {
              toast.error(error ?? "The document could not be generated.");
            }

            const batch = genBatchRef.current;
            if (!batch.active) {
              setGenDoc(null);
              return;
            }
            if (doc) batch.ok += 1;
            else batch.failed.push(docSpec(genDoc).label);

            // Advance the queue, re-checking eligibility against the documents
            // as they now stand — every attach consumes a slot. Filtering by the
            // queue keeps its order and stops a just-failed kind being retried.
            const remaining = generatableDocTypes(
              genSource,
              nextDocuments,
              MAX_DOCS - nextDocuments.length,
            ).filter((t) => genQueue.includes(t));
            if (remaining.length > 0) {
              setGenQueue(remaining.slice(1));
              setGenDoc(remaining[0]);
              return;
            }

            // Batch over. Anything still queued was skipped (the cap, usually) —
            // said out loud, since a document you expected simply absent reads
            // as a bug.
            const skipped = genQueue
              .filter((t) => !isDocTypeAttached(t, nextDocuments))
              .map((t) => docSpec(t).label);
            genBatchRef.current = { active: false, total: 0, ok: 0, failed: [] };
            setGenQueue([]);
            setGenDoc(null);
            if (skipped.length > 0) {
              // Usually the 10-file cap; a required field cleared mid-run lands
              // here too, so the message does not claim which.
              toast.error(`Skipped — no longer possible: ${skipped.join(", ")}.`);
            }
            if (batch.failed.length > 0) {
              toast.error(`${batch.ok} attached, ${batch.failed.length} failed: ${batch.failed.join(", ")}.`);
            } else if (batch.ok > 1 && skipped.length === 0) {
              toast.success(`All ${batch.ok} documents attached.`);
            }
          }}
        />
      )}
    </form>
  );
}
