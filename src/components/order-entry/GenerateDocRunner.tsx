"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { WhatsAppChat, makeRandomization } from "@/components/dashboard/ChatImageGenerator";
import type { CaseRow } from "@/components/dashboard/shared";
import { uploadOrderDocument } from "@/actions/order";
import type { OrderDocument } from "@/lib/order-types";
import {
  docSpec,
  documentSeed,
  generatedFilename,
  type GeneratedDocType,
  type GeneratorSource,
} from "@/lib/order-documents";

export interface GenerateDocSource extends GeneratorSource {
  idType: string;
  email: string;
  serviceCategory: string;
}

interface Props {
  type: GeneratedDocType;
  source: GenerateDocSource;
  /** Sequence suffix for the stored filename — how many of this type exist. */
  existingOfType: number;
  /** Called once, with the attached document or an error. Always called. */
  onDone: (result: { doc?: OrderDocument; error?: string }) => void;
  /** Pool image to append after an internet bill. Omitted when the pool is empty. */
  umobileImageId?: string | null;
  /** Shared TA + Auth Letter landlord/witness seed for this generate. */
  partiesSeed?: number | null;
}

/**
 * Generate one document from the draft and attach it to the order — no dialog.
 *
 * Renders nothing the agent sees. The chat is the reason this is a component at
 * all rather than a plain function: it is not an endpoint but the closing script
 * rasterized from the DOM, so it needs a real mounted node to photograph. The
 * four PDFs come from /api/orders/generate-document and use none of that.
 *
 * The progress indicator lives on the button in the form, next to what was
 * clicked, rather than here.
 */
export default function GenerateDocRunner({ type, source, existingOfType, onDone, umobileImageId, partiesSeed }: Props) {
  const spec = docSpec(type);
  const seed = documentSeed(source.idNumber);
  const chatRef = useRef<HTMLDivElement>(null);
  const [rand] = useState(makeRandomization);

  const run = useCallback(async () => {
    try {
      let bytes: Blob;

      if (type === "chat") {
        const node = chatRef.current;
        if (!node) throw new Error("The chat could not be rendered.");
        const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: rand.wallpaper });
        bytes = await (await fetch(dataUrl)).blob();
      } else {
        const res = await fetch("/api/orders/generate-document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            fullName: source.fullName,
            idNumber: source.idNumber,
            fullAddress: source.fullAddress,
            mobile: source.mobile,
            offerName: source.offerName,
            ...(type === "internet_bill" && umobileImageId
              ? { umobileImageId }
              : {}),
            ...((type === "tenancy_agreement" || type === "authorization_letter")
              && partiesSeed != null
              ? { partiesSeed: Number(partiesSeed) }
              : {}),
          }),
        });
        if (!res.ok) {
          // The route answers failures as JSON and successes as PDF bytes.
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `Generation failed (${res.status}).`);
        }
        bytes = await res.blob();
      }

      const filename = generatedFilename(type, seed);
      const file = new File([bytes], filename, {
        type: spec.ext === "pdf" ? "application/pdf" : "image/png",
      });
      const fd = new FormData();
      fd.append("file", file);
      fd.append("idNumber", source.idNumber);
      fd.append("idType", source.idType);
      fd.append("docType", spec.attachAs);
      if (spec.attachLabel) fd.append("otherLabel", spec.attachLabel);
      fd.append("seq", String(existingOfType + 1));

      // uploadOrderDocument THROWS on a transport failure rather than returning
      // {success:false} — the outer catch is what stops that stranding the
      // button in its spinning state forever.
      const res = await uploadOrderDocument(fd);
      if (!res.success) {
        onDone({ error: res.error ?? "The document could not be attached." });
        return;
      }
      onDone({ doc: { type: res.type, url: res.url, key: res.key, filename: res.filename } });
    } catch (e) {
      onDone({ error: e instanceof Error ? e.message : "Generation failed." });
    }
  }, [type, rand.wallpaper, source, seed, spec, existingOfType, onDone, umobileImageId, partiesSeed]);

  // `run` is held in a ref and the effect depends only on `type`, so a parent
  // re-render cannot cancel the pending generate.
  //
  // The obvious version — `useEffect(..., [run, type])` guarded by a "have I
  // started?" ref — silently never runs: `run`'s identity changes on the parent's
  // next render, the cleanup clears the pending timer, and the re-run then hits
  // the guard and returns without scheduling a replacement. The spinner spins
  // forever and nothing is ever generated.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    // One frame for the off-screen chat to lay out before it is photographed.
    // Under Strict Mode's double mount the first timer is cleared and the second
    // fires, so this still generates exactly once.
    const timer = setTimeout(() => runRef.current(), type === "chat" ? 150 : 0);
    return () => clearTimeout(timer);
  }, [type]);

  if (type !== "chat") return null;

  const chatCase: CaseRow = {
    case_no: seed,
    case_url: null,
    full_name: source.fullName,
    full_address: source.fullAddress,
    mobile: source.mobile,
    email: source.email || null,
    id_no: source.idNumber,
    provider: source.serviceCategory || null,
    package: source.offerName,
    order_no: null,
    agent: null,
    agent_remark: null,
    status: null,
    internet_bill_url: null,
    utility_bill_url: null,
    case_created_at: null,
    updated_at: null,
  };

  return (
    <div style={{ position: "absolute", left: -9999, top: -9999 }} aria-hidden>
      <div ref={chatRef}>
        <WhatsAppChat
          caseData={chatCase}
          wallpaper={rand.wallpaper}
          time={rand.time}
          unreadCount={rand.unreadCount}
          installOffsetDays={rand.installOffsetDays}
        />
      </div>
    </div>
  );
}
