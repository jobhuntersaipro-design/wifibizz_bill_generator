"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { saveOrder, uploadOrderDocument, lookupPostcode, getOrder } from "@/actions/order";
import { MAX_DOCS, type OrderDocument } from "@/lib/order-types";
import { parseMykad, inferRace } from "@/lib/mykad";
import {
  DEALER_OFFERS,
  ID_TYPES,
  MYKAD_LIKE_ID_TYPES,
  type IdType,
} from "@/lib/dealer-offers";
import { MALAYSIA_STATES } from "@/lib/malaysia-states";

const DOC_TYPES = [
  { value: "id", label: "Customer ID copy" },
  { value: "utility_bill", label: "Utility Bill" },
  { value: "other", label: "Other" },
];

// Shared field styles — light border + hover to signal clickability.
const inputCls =
  "rounded-lg h-10 border-[#E3E8EF] hover:border-[#635BFF]/60 focus:border-[#635BFF] transition-colors";
const selectCls =
  "select-chevron w-full pl-3 h-10 rounded-lg border border-[#CBD2DC] bg-white text-sm text-[#0A2540] hover:border-[#635BFF] focus:border-[#635BFF] focus:outline-none cursor-pointer transition-colors";
const labelCls = "text-xs font-medium text-[#425466]";
const cardCls = "bg-white rounded-lg border border-[#E3E8EF]";
const headCls = "px-6 py-3 border-b border-[#E3E8EF] text-sm font-semibold text-[#0A2540]";

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

  // Residence address for the customer profile: postcode auto-detects city/state
  // (Google geocode), agent types the street. (The serviceable service address
  // via the portal QryNIGAddress picker is a separate, later feasibility step.)
  const [postcode, setPostcode] = useState("");
  const [stateVal, setStateVal] = useState("");
  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [detecting, setDetecting] = useState(false);

  const [offerName, setOfferName] = useState("");
  const [offerCategory, setOfferCategory] = useState("");
  const [pkgQuery, setPkgQuery] = useState("");
  const [pkgOpen, setPkgOpen] = useState(false);
  const pkgRef = useRef<HTMLDivElement>(null);

  const [remarks, setRemarks] = useState("");

  const [documents, setDocuments] = useState<OrderDocument[]>([]);
  const [docType, setDocType] = useState("id");
  const [otherLabel, setOtherLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [saving, setSaving] = useState(false);

  const isMykadLike = MYKAD_LIKE_ID_TYPES.includes(idType);
  const emailValid = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

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

  const filteredOffers = useMemo(() => {
    const q = pkgQuery.trim().toLowerCase();
    return q ? DEALER_OFFERS.filter((o) => o.name.toLowerCase().includes(q)) : DEALER_OFFERS;
  }, [pkgQuery]);

  // Close the package dropdown when clicking anywhere outside it.
  useEffect(() => {
    if (!pkgOpen) return;
    function onDown(e: MouseEvent) {
      if (pkgRef.current && !pkgRef.current.contains(e.target as Node)) setPkgOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pkgOpen]);

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
        setOfferName(o.offerName || "");
        setOfferCategory(o.offerCategory || "");
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

  async function addDoc(file: File | undefined) {
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!emailValid) {
      toast.error("Enter a valid email address.");
      return;
    }
    // Residence address is required — an empty address is what makes the portal
    // reject the customer profile as "data incomplete", so block it here.
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
    if (!street.trim()) {
      toast.error("Enter the street address.");
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
      offerCategory,
      offerName,
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
    <form onSubmit={handleSave} className="space-y-5">
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
            <Label className={labelCls}>ID Number</Label>
            <Input
              value={idNumber}
              onChange={(e) => handleIdNumberChange(e.target.value)}
              required
              className={`${inputCls} uppercase`}
              placeholder={isMykadLike ? "12-digit MyKad" : "ID / Passport number"}
              inputMode={isMykadLike ? "numeric" : "text"}
            />
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
            <Label className={labelCls}>Email Address</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} ${!emailValid ? "border-[#DF1B41] focus:border-[#DF1B41]" : ""}`} placeholder="name@example.com" />
            {!emailValid && <p className="text-[11px] text-[#DF1B41]">Enter a valid email address.</p>}
          </div>
        </div>
      </div>

      {/* Installation Address (customer residence) — postcode auto-detects
          city + state (geocode); the agent types the street. */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className={headCls}>Installation Address</div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className={labelCls}>Postcode <span className="text-[#DF1B41]">*</span> {detecting && <span className="text-[#697386]">(detecting…)</span>}</Label>
            <Input value={postcode} onChange={(e) => handlePostcode(e.target.value)} className={inputCls} placeholder="40150" inputMode="numeric" />
          </div>
          <div className="space-y-1.5">
            <Label className={labelCls}>State <span className="text-[#DF1B41]">*</span> <span className="text-[#697386]">(auto)</span></Label>
            <select value={stateVal} onChange={(e) => setStateVal(e.target.value)} className={selectCls}>
              <option value="">---</option>
              {MALAYSIA_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className={labelCls}>City <span className="text-[#DF1B41]">*</span> <span className="text-[#697386]">(auto)</span></Label>
            <Input value={city} onChange={(e) => setCity(e.target.value.toUpperCase())} className={`${inputCls} uppercase`} placeholder="SHAH ALAM" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className={labelCls}>Street Address <span className="text-[#DF1B41]">*</span></Label>
            <Input value={street} onChange={(e) => setStreet(e.target.value.toUpperCase())} className={`${inputCls} uppercase`} placeholder="UNIT / STREET / AREA" />
          </div>
        </div>
      </div>

      {/* Package — card NOT clipped so the dropdown shows fully */}
      <div className={cardCls}>
        <div className={headCls}>Package</div>
        <div className="p-6 space-y-1.5">
          <Label className={labelCls}>Main Offer</Label>
          <div className="relative" ref={pkgRef}>
            <Input
              value={pkgQuery || offerName}
              onChange={(e) => { setPkgQuery(e.target.value); setPkgOpen(true); setOfferName(""); }}
              onFocus={() => setPkgOpen(true)}
              className={inputCls}
              placeholder="Search packages here"
            />
            {pkgOpen && (
              <div className="absolute z-20 mt-1 w-full max-h-80 overflow-auto rounded-lg border border-[#E3E8EF] bg-white shadow-lg py-1">
                {filteredOffers.length === 0 && (
                  <div className="px-3 py-2 text-xs text-[#697386]">No matching package</div>
                )}
                {filteredOffers.map((o) => (
                  <button
                    key={o.name}
                    type="button"
                    onClick={() => { setOfferName(o.name); setOfferCategory(o.category); setPkgQuery(""); setPkgOpen(false); }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-[#0A2540] hover:bg-[#F6F9FC]"
                  >
                    <span>{o.name}</span>
                    <span className="ml-3 shrink-0 text-[11px] text-[#697386] tabular-nums">{o.bandwidth}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {offerName && <p className="text-[11px] text-green-700 pt-1">Selected: {offerName}</p>}
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

      {/* Documents */}
      <div className={`${cardCls} overflow-hidden`}>
        <div className={headCls}>Documents <span className="text-[#697386] font-normal">({documents.length}/{MAX_DOCS})</span></div>
        <div className="p-6 space-y-4">
          <p className="text-[11px] text-[#697386]">
            Customer ID copy required. Up to {MAX_DOCS} files, max 5MB each (JPG/PNG/PDF/WEBP).
            Saved as {idNumber || "{id}"}_
            {docType === "utility_bill"
              ? "utilitybill"
              : docType === "other"
                ? (otherLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "doc")
                : idType.toLowerCase()}
            _n.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className={labelCls}>Type</Label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)} className={selectCls}>
                {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
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

          {/* Drag-and-drop zone (also click-to-browse). */}
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
            <span className="text-[11px] text-[#697386]">JPG, PNG, PDF, WEBP · max 5MB each</span>
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
        <Button type="submit" disabled={saving} className="h-10 px-6 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] hover-glow">
          {saving ? "Saving…" : draftId ? "Update Draft" : "Save Order"}
        </Button>
      </div>
    </form>
  );
}
