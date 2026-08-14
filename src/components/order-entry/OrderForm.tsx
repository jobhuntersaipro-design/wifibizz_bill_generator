"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { saveOrder, uploadOrderDocument, lookupPostcode, getOrder, searchDealerAddress } from "@/actions/order";
import { MAX_DOCS, type OrderDocument, type AddressResult } from "@/lib/order-types";
import { parseMykad, inferRace, formatMykad, isCompleteMykad, isValidEmail } from "@/lib/mykad";
import {
  DEALER_OFFERS,
  OFFER_CATEGORIES,
  ID_TYPES,
  MYKAD_LIKE_ID_TYPES,
  type IdType,
} from "@/lib/dealer-offers";
import { DEALER_DEVICES } from "@/lib/dealer-devices";
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
import {
  validateMalaysianAddress,
  toPortalState,
  searchKeywordFrom,
  widenKeyword,
} from "@/lib/malaysia-address";

// Shared field styles — light border + hover to signal clickability.
const inputCls =
  "rounded-lg h-10 border-[#E3E8EF] hover:border-[#635BFF]/60 focus:border-[#635BFF] transition-colors";
const selectCls =
  "select-chevron w-full pl-3 h-10 rounded-lg border border-[#CBD2DC] bg-white text-sm text-[#0A2540] hover:border-[#635BFF] focus:border-[#635BFF] focus:outline-none cursor-pointer transition-colors";
const labelCls = "text-xs font-medium text-[#425466]";
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

  // ONE address field: the agent types the complete address (the shape the
  // portal returns as `concatAddress`) and Confirm derives postcode / state /
  // city from it, then searches the portal for the serviceable unit.
  const [postcode, setPostcode] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [detecting, setDetecting] = useState(false);

  // Serviceable SERVICE address (portal QryNIGAddress) — required for feasibility.
  // The agent searches, picks the exact unit, and we store the resourceInstId so
  // the backend selects the address "By Address Id" (the reliable path).
  const [addressId, setAddressId] = useState("");
  const [addressFull, setAddressFull] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [addrResults, setAddrResults] = useState<AddressResult[]>([]);
  const [addrSearching, setAddrSearching] = useState(false);
  const [addrSearched, setAddrSearched] = useState(false);
  // Set once the typed address validates — that's what unlocks the derived
  // postcode / state / city for manual correction.
  const [addrConfirmed, setAddrConfirmed] = useState(false);
  const [addrError, setAddrError] = useState("");
  // What the progress bar is reporting right now. The portal returns no
  // percentage, so this narrates the stage instead of faking one.
  const [addrStage, setAddrStage] = useState("");
  // Fields most recently auto-filled by Confirm — drives the one-shot flash.
  const [autoFilled, setAutoFilled] = useState<string[]>([]);

  const [offerName, setOfferName] = useState("");
  const [offerCategory, setOfferCategory] = useState("");
  const [pkgQuery, setPkgQuery] = useState("");
  const [speedFilter, setSpeedFilter] = useState("");
  const [pkgOpen, setPkgOpen] = useState(false);
  const pkgRef = useRef<HTMLDivElement>(null);

  const [deviceCode, setDeviceCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [devQuery, setDevQuery] = useState("");
  const [devCategory, setDevCategory] = useState("");
  const [devOpen, setDevOpen] = useState(false);
  const devRef = useRef<HTMLDivElement>(null);

  const [remarks, setRemarks] = useState("");

  const [documents, setDocuments] = useState<OrderDocument[]>([]);
  const [docType, setDocType] = useState("im_conversation");
  const [otherLabel, setOtherLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [saving, setSaving] = useState(false);

  const isMykadLike = MYKAD_LIKE_ID_TYPES.includes(idType);
  // Email is required — the scraper types it straight into the portal's
  // emailAddr field, and a blank one only surfaces as a "data incomplete"
  // rejection much later in the flow.
  const emailValid = isValidEmail(email);
  // Only complain about a half-typed ID once the agent has moved on / typed
  // enough to mean it — an empty field is the "required" error, not this one.
  const idNumberIncomplete = isMykadLike && idNumber.length > 0 && !isCompleteMykad(idNumber);

  // Documents: IM Conversation is the default + always required. The ID document
  // matches the chosen ID Type (MyKad / Passport). Required = IM Conversation +
  // ONE identity doc (MyKad / Passport / Others) — MyKad itself isn't mandatory.
  const idDocType = isMykadLike ? "mykad" : idType === "Passport" ? "passport" : "id";
  const idDocLabel = isMykadLike ? "MyKad" : idType === "Passport" ? "Passport" : "ID Document";
  const docTypeOptions = [
    { value: "im_conversation", label: "IM Conversation" },
    { value: idDocType, label: idDocLabel },
    { value: "other", label: "Others" },
    { value: "utility_bill", label: "Utility Bill" },
  ];
  const hasImDoc = documents.some((d) => d.type === "im_conversation");
  const hasIdentityDoc = documents.some((d) => ["mykad", "passport", "id", "other"].includes(d.type));

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

  // The flash is a one-shot: drop the marker once it has played so the next
  // Confirm re-adds the class and the animation runs again.
  useEffect(() => {
    if (!autoFilled.length) return;
    const t = setTimeout(() => setAutoFilled([]), 1000);
    return () => clearTimeout(t);
  }, [autoFilled]);

  // 60 offers is too many for one flat list. Narrow by speed first (the thing
  // the customer actually asked for), then group what's left by add-on flavour
  // — that's the real second axis, since only 9 offers are "with Device" and
  // the device itself is a separate step after the package.
  const filteredOffers = useMemo(() => {
    const q = pkgQuery.trim().toLowerCase();
    return DEALER_OFFERS.filter((o) => {
      if (q && !o.name.toLowerCase().includes(q)) return false;
      if (!speedFilter) return true;
      if (speedFilter === "BIZ" || speedFilter === "VOF") return o.category === OFFER_CATEGORIES[speedFilter];
      return o.category === OFFER_CATEGORIES.HOME && o.bandwidth === speedFilter;
    });
  }, [pkgQuery, speedFilter]);

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

  // Counts per speed chip, so the agent sees where the packages actually are.
  const speedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of DEALER_OFFERS) {
      const key =
        o.category === OFFER_CATEGORIES.BIZ ? "BIZ" : o.category === OFFER_CATEGORIES.VOF ? "VOF" : o.bandwidth;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, []);

  // Device picker only applies to "with device" bundles (the portal shows the
  // device/add-on tree after such a package). Clearing the package clears it.
  const isWithDevice = /with\s*device/i.test(offerName);
  // Same treatment as packages: narrow by category, then collapse repeated
  // models under one header so only the varying part shows per row.
  const filteredDevices = useMemo(() => {
    const q = devQuery.trim().toLowerCase();
    return DEALER_DEVICES.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q)) return false;
      return !devCategory || deviceCategory(d.name) === devCategory;
    });
  }, [devQuery, devCategory]);
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
        // An existing draft already has its address fields — never lock the
        // agent out of editing what was saved before this flow existed.
        setAddrConfirmed(Boolean(o.postcode || o.state || o.city || o.addressId));
        setOfferName(o.offerName || "");
        setOfferCategory(o.offerCategory || "");
        setDeviceCode(o.deviceCode || "");
        setDeviceName(o.deviceName || "");
        setRemarks(o.remarks || "");
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

  async function addDoc(file: File | undefined, side?: "front" | "back") {
    if (!file) return;
    if (!idNumber.trim()) {
      toast.error("Enter the ID number before uploading documents.");
      return;
    }
    if (docType === "other" && !otherLabel.trim()) {
      toast.error('Enter a document type name for "Other".');
      return;
    }
    if (documents.length >= MAX_DOCS) {
      toast.error(`Up to ${MAX_DOCS} files only.`);
      return;
    }
    const seq = documents.filter((d) => d.type === docType).length + 1;
    setUploading(true);
    const fd = new FormData();
    if (side) fd.append("side", side);
    fd.append("file", file);
    fd.append("idNumber", idNumber);
    fd.append("idType", idType);
    fd.append("docType", docType);
    if (docType === "other") fd.append("otherLabel", otherLabel.trim());
    fd.append("seq", String(seq));
    const res = await uploadOrderDocument(fd);
    setUploading(false);
    if (res.success) {
      setDocuments((d) => [...d, { type: res.type, url: res.url, key: res.key, filename: res.filename }]);
      toast.success("Document uploaded.");
    } else {
      toast.error(res.error ?? "Upload failed");
    }
  }

  // Drag-and-drop: upload dropped files one at a time (respects MAX_DOCS).
  async function addDocs(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (documents.length >= MAX_DOCS) break;
      await addDoc(f);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addDocs(e.dataTransfer.files);
  }

  function handleNameBlur() {
    if (fullName && !race) setRace(inferRace(fullName));
  }

  /**
   * Editing the address invalidates a previously picked unit — otherwise the
   * green "✓ Serviceable" strip (and the addressId the order is submitted with)
   * keeps pointing at a unit the agent has since typed away from.
   */
  function handleStreetChange(value: string) {
    const next = value.toUpperCase();
    setStreet(next);
    if (addrError) setAddrError("");
    if (autoFilled.length) setAutoFilled([]);
    if (addressId && next !== addressFull.toUpperCase()) {
      setAddressId("");
      setAddressFull("");
      setServiceCategory("");
    }
  }

  // Confirm the typed full address: validate the format, derive postcode /
  // state / city from it, then ask the portal (QryNIGAddress) for the matching
  // serviceable units. Picking one stores the resourceInstId used for
  // feasibility "By Address Id".
  async function confirmAddress() {
    const q = street.trim();

    // A fresh Confirm re-decides serviceability from scratch.
    setAddressId("");
    setAddressFull("");
    setServiceCategory("");

    const check = validateMalaysianAddress(q);
    if (!check.ok) {
      setAddrError(check.reason);
      setAddrResults([]);
      setAddrSearched(false);
      toast.error(check.reason);
      return;
    }
    setAddrError("");

    // Fill the derived fields immediately — they hold even if the portal search
    // comes back empty, so the agent can still save a draft. Flag which ones we
    // touched so each flashes once instead of silently changing under the agent.
    setPostcode(check.postcode);
    setStateVal(check.state);
    if (check.city) setCity(check.city);
    setAutoFilled(["postcode", "state", ...(check.city ? ["city"] : [])]);
    setAddrConfirmed(true);
    if (check.hint) toast.message(check.hint);

    const portalState = toPortalState(check.state);
    if (!portalState) {
      const reason = `The portal doesn't support address search for ${check.state}.`;
      setAddrError(reason);
      toast.error(reason);
      return;
    }

    setAddrSearching(true);
    setAddrSearched(true);
    setAddrStage(`Searching the Unifi portal in ${check.state}…`);
    // The state travels as its own request field, so the keyword drops the
    // trailing "<STATE> MALAYSIA <postcode>" tail. If the exact address finds
    // nothing, retry once without the leading unit number — the portal indexes
    // street and building names more reliably than units.
    const keyword = searchKeywordFrom(q);
    let res = await searchDealerAddress(portalState, keyword, "keyword");
    if (res.success && res.addresses.length === 0) {
      const wider = widenKeyword(keyword);
      if (wider && wider !== keyword) {
        setAddrStage("No exact match — widening the search…");
        res = await searchDealerAddress(portalState, wider, "keyword");
      }
    }
    setAddrSearching(false);
    setAddrStage("");
    if (!res.success) {
      setAddrResults([]);
      toast.error(res.error ?? "Address search failed.");
      return;
    }
    // Surface the closest match to what was typed first (the portal returns the
    // building's units in arbitrary order — e.g. B,D,A,C,E — which is annoying).
    const qn = q.toUpperCase();
    const prefix = (s: string) => {
      const a = s.toUpperCase();
      let i = 0;
      while (i < a.length && i < qn.length && a[i] === qn[i]) i++;
      return i;
    };
    const sorted = [...res.addresses].sort((x, y) => {
      const ex = x.addressFull.toUpperCase() === qn ? 1 : 0;
      const ey = y.addressFull.toUpperCase() === qn ? 1 : 0;
      if (ex !== ey) return ey - ex; // exact match first
      return prefix(y.addressFull) - prefix(x.addressFull); // then longest common prefix
    });
    setAddrResults(sorted);
    if (sorted.length === 0) toast.message("No serviceable address found for that address.");
  }

  // Picking a serviceable unit fills EVERYTHING — feasibility id + the profile's
  // residence address — so there's a single address source, no second field.
  function pickAddress(a: AddressResult) {
    setAddressId(a.addressId);
    setAddressFull(a.addressFull);
    setServiceCategory(a.serviceCategory ?? "");
    // Derive the customer-profile residence fields from the picked address.
    // Match the State to a MALAYSIA_STATES option (title-case) so the dropdown
    // reflects it instead of falling back to "---".
    if (a.state) {
      const st = MALAYSIA_STATES.find((s) => s.toUpperCase() === a.state!.toUpperCase());
      setStateVal(st ?? a.state);
    }
    if (a.city) setCity(a.city.toUpperCase());
    if (a.postcode) setPostcode(a.postcode);
    setStreet(a.addressFull.toUpperCase());
    setAddrResults([]);
    setAddrSearched(false);
    setAddrConfirmed(true);
    setAddrError("");
    toast.success("Serviceable address selected.");
  }

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
    // (A confirmed addressId is NOT required: an order can still be saved as a
    // draft while the agent sorts out serviceability.)
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
    if (!hasImDoc) {
      toast.error("Attach the IM Conversation document (required).");
      return;
    }
    if (!hasIdentityDoc) {
      toast.error("Attach an ID document (MyKad / Passport / Others).");
      return;
    }
    // "with Device" packages require a device — the portal blocks the order
    // ("select one offer in the Smart Device group") without one.
    if (isWithDevice && !deviceCode) {
      toast.error("This package includes a device — pick a device.");
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

      {/* Installation Address — ONE card, ONE field: the agent types the
          complete address and Confirm derives postcode / state / city from it,
          then searches the portal for the serviceable unit to pick. */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className={headCls}>
          Installation Address <span className="text-[#697386] font-normal">— type the full address, then Confirm</span>
        </div>
        <div className="p-6 space-y-4">
          {/* Full Address IS the search field — Confirm validates it, fills the
              fields below, and asks the portal for the serviceable units. */}
          <div className="space-y-1.5">
            <Label className={labelCls}>
              Full Address <span className="text-[#DF1B41]">*</span>
            </Label>
            <div className="flex gap-2">
              <Input
                value={street}
                onChange={(e) => handleStreetChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmAddress(); } }}
                className={`flex-1 ${inputCls} uppercase`}
                placeholder="A-07-15 PERSIARAN SAUJANA PUTRA UTAMA 7 BANDAR SAUJANA PUTRA JENJAROM SELANGOR MALAYSIA 42610"
              />
              <Button
                type="button"
                onClick={confirmAddress}
                disabled={addrSearching}
                aria-busy={addrSearching}
                className="h-10 px-4 rounded-lg text-sm font-medium bg-[#0A2540] hover:bg-[#635BFF] transition-colors duration-200 hover-glow press-effect cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {addrSearching ? "Confirming…" : "Confirm"}
              </Button>
            </div>

            {/* Progress while the portal is being queried. The portal reports no
                percentage, so this is an indeterminate bar plus a stage label —
                honest about "working" without inventing a completion figure. */}
            {addrSearching && (
              <div className="space-y-1.5 pt-0.5" role="status" aria-live="polite">
                <div className="h-1 w-full overflow-hidden rounded-full bg-[#EEF1F6]">
                  <div className="progress-indeterminate h-full w-1/3 rounded-full bg-[#635BFF]" />
                </div>
                <p className="text-[11px] text-[#697386]">{addrStage || "Checking the address…"}</p>
              </div>
            )}

            {/* Guidance: what "full address" means, in the order the portal
                writes it, with the parts named so the agent can self-check. */}
            {!addrSearching && (
              <div className="rounded-lg border border-[#E3E8EF] bg-[#F6F9FC] px-3 py-2.5 space-y-1.5">
                <p className="text-[11px] text-[#0A2540]">
                  <span className="font-medium">Paste the address exactly as the Unifi portal shows it.</span>{" "}
                  It must already exist and be serviceable there — checking that is the agent&apos;s responsibility.
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
                <p className="text-[11px] text-[#697386]">
                  Confirm fills Postcode, State and City for you, then lists the serviceable units to pick from.
                </p>
              </div>
            )}
            {addrError && (
              <p className="flex items-start gap-1.5 text-[11px] text-[#DF1B41]" role="alert">
                <svg viewBox="0 0 24 24" className="mt-px h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
                </svg>
                <span>{addrError}</span>
              </p>
            )}
            {addressId ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-green-500 bg-green-50 px-3 py-2 text-[12px] text-[#0A2540]">
                <span><span className="text-green-700 font-medium">✓ Serviceable</span> {addressFull}{serviceCategory && ` · ${serviceCategory}`}</span>
                <button type="button" onClick={() => { setAddressId(""); setAddressFull(""); setServiceCategory(""); }} className="shrink-0 text-[11px] text-[#DF1B41] hover:underline">Clear</button>
              </div>
            ) : addrResults.length > 0 ? (
              <p className="text-[11px] text-[#697386]">Pick a unit below to confirm it&apos;s serviceable. Closest match to what you typed is shown first.</p>
            ) : null}
            {addrResults.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-lg border border-[#E3E8EF] divide-y divide-[#F0F3F8]">
                {addrResults.map((a) => (
                  <button
                    key={a.addressId}
                    type="button"
                    onClick={() => pickAddress(a)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px] text-[#0A2540] cursor-pointer transition-colors duration-200 hover:bg-[#F6F9FC] focus:bg-[#F6F9FC] focus:outline-none"
                  >
                    <span className="truncate">{a.addressFull}</span>
                    {a.serviceCategory && (
                      <span className="ml-3 shrink-0 text-[11px] text-[#697386]">{a.serviceCategory}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {addrSearched && !addrSearching && addrResults.length === 0 && !addressId && (
              <p className="text-[11px] text-[#DF1B41]">Not found in the Unifi portal. Check the address in the portal first — it must exist and be serviceable.</p>
            )}
          </div>

          {/* Derived from the address above on Confirm — kept visible and, once
              confirmed, editable so the agent can correct what was derived. */}
          <div className="border-t border-[#F0F3F8] pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <AutoIcon />
              <span className="text-[11px] font-medium text-[#0A2540]">Extracted from the address above</span>
              <span className="text-[11px] text-[#697386]">
                {addrConfirmed ? "— check these, edit if the portal disagrees" : "— fills in when you press Confirm"}
              </span>
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
                  readOnly={!addrConfirmed}
                  aria-readonly={!addrConfirmed}
                  className={`${inputCls} transition-colors duration-200 ${autoFilled.includes("postcode") ? "field-flash" : ""} ${!addrConfirmed ? "bg-[#F6F9FC] text-[#697386] cursor-not-allowed" : ""}`}
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
                  disabled={!addrConfirmed}
                  className={`${selectCls} transition-colors duration-200 ${autoFilled.includes("state") ? "field-flash" : ""} ${!addrConfirmed ? "bg-[#F6F9FC] text-[#697386] opacity-70 cursor-not-allowed" : ""}`}
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
                  readOnly={!addrConfirmed}
                  aria-readonly={!addrConfirmed}
                  className={`${inputCls} uppercase transition-colors duration-200 ${autoFilled.includes("city") ? "field-flash" : ""} ${!addrConfirmed ? "bg-[#F6F9FC] text-[#697386] cursor-not-allowed" : ""}`}
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
                All <span className="tabular-nums opacity-70">{DEALER_OFFERS.length}</span>
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
              <span>Selected: {offerName}{isWithDevice && " — pick the device below"}</span>
            </p>
          )}
        </div>
      </div>

      {/* Device — only for "with device" bundles (picked after the package).
          Ranks above the later cards for its own dropdown, below Package. */}
      {isWithDevice && (
        <div className={`${cardCls} relative z-20`}>
          <div className={headCls}>
            Device <span className="text-[#697386] font-normal">— pick the type, then the model</span>
          </div>
          <div className="p-6 space-y-3">
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
                  All <span className="tabular-nums opacity-70">{DEALER_DEVICES.length}</span>
                </button>
                {DEVICE_CATEGORIES.filter((c) => DEVICE_CATEGORY_COUNTS[c]).map((c) => (
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
                    {c} <span className="tabular-nums opacity-70">{DEVICE_CATEGORY_COUNTS[c]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className={labelCls}>Device / Add-on <span className="text-[#DF1B41]">*</span></Label>
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
          </div>
        </div>
      )}

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

      {/* Documents */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className={headCls}>Documents <span className="text-[#697386] font-normal">({documents.length}/{MAX_DOCS})</span></div>
        <div className="p-6 space-y-4">
          <p className="text-[11px] text-[#697386]">
            <span className={hasImDoc ? "text-green-700" : "text-[#DF1B41]"}>IM Conversation</span>
            {" and one of "}
            <span className={hasIdentityDoc ? "text-green-700" : "text-[#DF1B41]"}>MyKad / Passport / Others</span>
            {" are required. Up to "}{MAX_DOCS} files, max 5MB each (JPG/PNG/PDF/WEBP).
            Saved as {idNumber || "{id}"}_
            {docType === "utility_bill"
              ? "utilitybill"
              : docType === "im_conversation"
                ? "imconversation"
                : docType === "other"
                  ? (otherLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "doc")
                  : idType.toLowerCase()}
            _n.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className={labelCls}>Type</Label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)} className={selectCls}>
                {docTypeOptions.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            {docType === "other" && (
              <div className="space-y-1.5">
                <Label className={labelCls}>Document Name</Label>
                <Input
                  value={otherLabel}
                  onChange={(e) => setOtherLabel(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. tenancy agreement"
                />
              </div>
            )}
            {uploading && <span className="text-[11px] text-[#697386] pb-2">Uploading…</span>}
          </div>

          {/* Drag-and-drop zone (also click-to-browse). `multiple` lets any doc
              type take 2+ files (e.g. MyKad front + back) under the same Type. */}
          <label
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
              dragActive ? "border-[#635BFF] bg-[#635BFF]/5" : "border-[#CBD2DC] hover:border-[#635BFF]/60"
            } ${uploading || documents.length >= MAX_DOCS ? "opacity-50 pointer-events-none" : ""}`}
          >
            <span className="text-[13px] font-medium text-[#425466]">
              Drag &amp; drop files here, or <span className="text-[#635BFF]">browse</span>
            </span>
            <span className="text-[11px] text-[#697386]">JPG, PNG, PDF, WEBP · max 5MB each · add 2+ files for the same type</span>
            <input
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.bmp,.pdf,.webp,.jfif"
              disabled={uploading || documents.length >= MAX_DOCS}
              onChange={(e) => { if (e.target.files) addDocs(e.target.files); e.target.value = ""; }}
              className="hidden"
            />
          </label>

          {documents.length > 0 && (
            <div className="space-y-1.5">
              {documents.map((d, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-[#F6F9FC] px-3 py-2">
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-[12px] text-[#0A2540] truncate hover:text-[#635BFF]">
                    {d.filename}
                  </a>
                  <button type="button" onClick={() => setDocuments((docs) => docs.filter((_, j) => j !== i))} className="ml-3 shrink-0 text-[11px] text-[#DF1B41] hover:underline">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving} aria-busy={saving} className="h-10 px-6 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] hover-glow press-effect cursor-pointer transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed">
          {saving ? "Saving…" : draftId ? "Update Draft" : "Save Order"}
        </Button>
      </div>
    </form>
  );
}
