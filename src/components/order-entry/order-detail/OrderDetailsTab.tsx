"use client";

import { useState } from "react";
import { DEFAULT_LEAD_HOURS } from "@/lib/appointment-settings";
import { Download, FileText, MapPin, Package, Paperclip, Phone, User, X } from "lucide-react";
import { formatCreatedFull, type OrderDocument, type OrderListItem } from "@/lib/order-types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAddress } from "../OrderRow";
import { SectionCard } from "./shared";

// The vocabulary the order form writes (identity types + the supporting-doc
// select). Anything unrecognised prettifies its slug rather than showing raw
// snake_case.
const DOC_TYPE_LABELS: Record<string, string> = {
  mykad: "MyKad",
  passport: "Passport",
  id: "ID Document",
  im_conversation: "IM Conversation",
  utility_bill: "Utility Bill",
  other: "Others",
};

function docTypeLabel(type: string): string {
  return (
    DOC_TYPE_LABELS[type] ??
    type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "jfif", "png", "bmp", "webp"]);

/** The same proxy URL, asking the route to serve inline for rendering. */
const viewUrl = (doc: OrderDocument) => `${doc.url}&view=1`;

const docExt = (doc: OrderDocument) => (doc.filename.split(".").pop() || "").toLowerCase();
const isImageDoc = (doc: OrderDocument) => IMAGE_EXTS.has(docExt(doc));

/**
 * Full-size look at one document: <img> for the raster types, <iframe> for a
 * PDF — both against the inline (`view=1`) form of the auth-gated proxy, since
 * the default attachment disposition would turn an iframe into a download.
 */
function DocumentPreviewDialog({ doc, onClose }: { doc: OrderDocument; onClose: () => void }) {
  const isImage = isImageDoc(doc);
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90dvh] w-full max-w-[calc(100%-2rem)] flex-col gap-0 bg-white p-0 sm:max-w-3xl"
      >
        <DialogTitle className="sr-only">Preview of {doc.filename}</DialogTitle>
        <DialogDescription className="sr-only">
          {docTypeLabel(doc.type)} document attached to this order.
        </DialogDescription>

        <header className="flex shrink-0 items-center gap-3 border-b border-[#E3E8EF] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight text-[#0A2540]">
              {doc.filename}
            </p>
            <p className="mt-0.5 text-[11px] text-[#8792A2]">
              {docTypeLabel(doc.type)} · {docExt(doc).toUpperCase()}
            </p>
          </div>
          <a
            href={doc.url}
            download
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-[#635BFF] transition-colors duration-150 hover:bg-[#EDEBFF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#635BFF]"
          >
            Download <Download className="h-3 w-3" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document preview"
            className="group -mr-1 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#697386] transition-colors duration-150 hover:bg-[#F6F9FC] hover:text-[#0A2540] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#635BFF]"
          >
            <X className="h-4 w-4 transition-transform duration-200 group-hover:rotate-90" aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-auto bg-[#F6F9FC] p-3">
          {isImage ? (
            /* eslint-disable-next-line @next/next/no-img-element -- an
               auth-gated private stream, not an optimisable static asset */
            <img
              src={viewUrl(doc)}
              alt={`${docTypeLabel(doc.type)} — ${doc.filename}`}
              className="m-auto max-h-full max-w-full rounded-lg object-contain"
            />
          ) : (
            /* Cross-document iframe: no load event worth waiting on, the
               browser paints its own PDF chrome (same as the e-RF preview). */
            <iframe
              src={viewUrl(doc)}
              title={`Preview of ${doc.filename}`}
              className="h-[70dvh] w-full rounded-lg border border-[#E3E8EF] bg-white"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One attached file: a thumbnail (images show themselves, a PDF shows a file
 * tile), filename and type chip. Clicking the row opens the in-place preview;
 * Download is its own always-visible control beside it, because saving the
 * file and looking at it are different intents.
 */
function DocumentRow({ doc, onPreview }: { doc: OrderDocument; onPreview: () => void }) {
  const ext = docExt(doc);
  const isImage = isImageDoc(doc);
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={onPreview}
        className="group flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-[#F6F9FC] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#635BFF]"
      >
        <span className="block h-12 w-16 shrink-0 overflow-hidden rounded-md border border-[#E3E8EF] bg-[#F6F9FC]">
          {isImage ? (
            /* eslint-disable-next-line @next/next/no-img-element -- an
               auth-gated private stream, not an optimisable static asset */
            <img
              src={viewUrl(doc)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover object-top transition-transform duration-200 ease-out group-hover:scale-[1.04]"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-[#EDEBFF]">
              <FileText className="h-4 w-4 text-[#635BFF]" aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-[#0A2540]">
            {doc.filename}
          </span>
          <span className="block text-[10px] text-[#8792A2]">
            {docTypeLabel(doc.type)} · {ext.toUpperCase()} · click to preview
          </span>
        </span>
      </button>
      <a
        href={doc.url}
        download
        aria-label={`Download ${doc.filename}`}
        title="Download"
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#697386] transition-colors duration-150 hover:bg-[#EDEBFF] hover:text-[#635BFF] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#635BFF]"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
      </a>
    </li>
  );
}

/**
 * One labelled value. A missing value renders as a dash rather than the row
 * hiding, so an incomplete draft is VISIBLY incomplete — a hidden row reads as
 * "not applicable", which is a different claim.
 */
function DetailRow({ label, value }: { label: string; value?: string | null }) {
  const has = !!value?.trim();
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="w-24 shrink-0 text-[11px] leading-5 text-[#697386]">{label}</dt>
      <dd
        className={`min-w-0 flex-1 break-words text-right text-[12px] leading-5 ${
          has ? "text-[#0A2540]" : "text-[#C1C9D2]"
        }`}
      >
        {has ? value : "—"}
      </dd>
    </div>
  );
}

/** The full draft, read-only — the record behind the row, without opening Edit. */
export function OrderDetails({ order }: { order: OrderListItem }) {
  // Which document the preview dialog is showing, by R2 key; null when closed.
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const previewDoc = order.documents.find((d) => d.key === previewKey) ?? null;

  return (
    <>
      <SectionCard icon={User} label="Customer" delay={0}>
        <dl className="divide-y divide-[#F0F3F7]">
          <DetailRow label="Full name" value={order.fullName} />
          <DetailRow label="ID" value={`${order.idType} · ${order.idNumber}`} />
          {order.idExpiry && <DetailRow label="ID expiry" value={order.idExpiry} />}
          <DetailRow label="Gender" value={order.gender} />
          <DetailRow label="Birthday" value={order.birthday} />
          <DetailRow label="Race" value={order.race} />
        </dl>
      </SectionCard>

      <SectionCard icon={Phone} label="Contact" delay={60}>
        <dl className="divide-y divide-[#F0F3F7]">
          <DetailRow label="Phone" value={order.phone} />
          <DetailRow label="Email" value={order.email} />
        </dl>
      </SectionCard>

      <SectionCard icon={MapPin} label="Installation address" delay={120}>
        <dl className="divide-y divide-[#F0F3F7]">
          <DetailRow label="Address" value={formatAddress(order)} />
          <DetailRow label="Postcode" value={order.postcode} />
          <DetailRow label="City" value={order.city} />
          <DetailRow label="State" value={order.state} />
        </dl>
      </SectionCard>

      <SectionCard icon={Package} label="Package" delay={180}>
        <dl className="divide-y divide-[#F0F3F7]">
          <DetailRow label="Main offer" value={order.offerName} />
          <DetailRow
            label="Device"
            value={
              order.deviceName
                ? order.deviceCode
                  ? `${order.deviceName} · #${order.deviceCode}`
                  : order.deviceName
                : null
            }
          />
        </dl>
      </SectionCard>

      {/* Replaces the old "Documents: N attached" count row — the files
          themselves are more useful than their number. An empty state still
          renders, because a missing section reads as "not applicable" while
          an order with no documents is a different, visible fact. */}
      <SectionCard icon={Paperclip} label={`Documents · ${order.documents.length}`} delay={240}>
        {order.documents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#E3E8EF] px-3 py-4 text-center text-[11px] text-[#8792A2]">
            No documents attached to this order.
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {order.documents.map((d) => (
              <DocumentRow key={d.key} doc={d} onPreview={() => setPreviewKey(d.key)} />
            ))}
          </ul>
        )}
      </SectionCard>

      {previewDoc && (
        <DocumentPreviewDialog doc={previewDoc} onClose={() => setPreviewKey(null)} />
      )}

      <SectionCard icon={FileText} label="Other" delay={300}>
        <dl className="divide-y divide-[#F0F3F7]">
          <DetailRow label="Remarks" value={order.remarks} />
          {/* The lead time this order submits with. A draft from before the
              field existed has none and submits with the default, which is what
              is shown — labelled, so it does not read as the agent's choice. */}
          <DetailRow
            label="Appointment lead time"
            value={
              order.appointmentLeadHours === null
                ? `${DEFAULT_LEAD_HOURS} hours (default)`
                : `${order.appointmentLeadHours} hour${order.appointmentLeadHours === 1 ? "" : "s"}`
            }
          />
          <DetailRow label="Reference" value={order.reference} />
          <DetailRow label="Created" value={formatCreatedFull(order.createdAt)} />
          {order.createdByEmail && (
            <DetailRow label="Created by" value={order.createdByEmail} />
          )}
        </dl>
      </SectionCard>
    </>
  );
}
