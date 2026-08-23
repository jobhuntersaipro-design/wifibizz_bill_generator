"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mergePdfs, type MergeSource } from "@/lib/bill-generator/merge-pdfs";
import { pngToPdfPage } from "@/lib/bill-generator/image-page";
import {
  buildMergeItems,
  reconcileMergeItems,
  moveMergeItem,
  mergeItemUrl,
  MERGE_DOC_TYPES,
  MERGE_DOC_LABELS,
  type MergeDocType,
  type MergeItem,
} from "@/lib/bill-generator/merge-plan";
import { MergeIcon, GripIcon, CloseIcon } from "./icons";
import { WhatsAppChat, makeRandomization } from "./ChatImageGenerator";
import type { CaseRow } from "./shared";

/** How many documents to fetch at once. The letter and the TIME invoice are
 *  generated per request, so this is deliberately gentle on the server. */
const FETCH_CONCURRENCY = 3;

/**
 * Combine one case's documents into a single PDF, in the browser.
 *
 * Nothing here generates or stores anything: it only fetches documents that can
 * already be served, merges them with pdf-lib and hands the result to the
 * browser's download. A bill that has never been generated is shown as
 * unavailable rather than quietly created — generating is what counts against
 * the case limit, and this feature is free.
 */
export default function MergePdfDialog({
  caseData,
  onAddressResolved,
  onClose,
}: {
  /** The single case whose documents are being combined. */
  caseData: CaseRow;
  /** Lets the table keep an address this dialog had to look up. */
  onAddressResolved?: (caseNo: string, address: string) => void;
  onClose: () => void;
}) {
  // The closing script is drawn from the case rather than fetched, so the dialog
  // keeps its own copy: an address looked up here has to reach the chat.
  const [chatCase, setChatCase] = useState<CaseRow>(caseData);
  const [addressLoading, setAddressLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const rand = useMemo(makeRandomization, []);
  // One case at a time, so the plan helpers get a single-element list.
  const cases = useMemo(() => [caseData], [caseData]);
  const [types, setTypes] = useState<MergeDocType[]>(["internet"]);
  const [items, setItems] = useState<MergeItem[]>(() =>
    buildMergeItems([caseData], ["internet"])
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Whether the agent has reordered or removed a row. Until they have, ticking a
  // type re-derives the list so it stays grouped per case; afterwards their
  // arrangement wins and new rows are appended to it.
  const [arranged, setArranged] = useState(false);
  const [merging, setMerging] = useState(false);
  const [done, setDone] = useState(0);

  // Re-derive whenever the ticked types change, keeping the agent's ordering and
  // their manual removals (see reconcileMergeItems).
  useEffect(() => {
    const derived = buildMergeItems(cases, types);
    setItems((current) => (arranged ? reconcileMergeItems(current, derived) : derived));
    // `arranged` is deliberately not a dependency: flipping it must not re-run
    // this and re-derive the very list the agent just arranged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, types]);

  // The chat prints the installation address, which a list-only crawl never
  // stored. Look it up the moment the chat is ticked — the same lazy fill the
  // row button does — rather than silently printing a dash.
  const wantsChat = types.includes("chat");
  const needsAddress = !((chatCase.full_address || "").trim()) && !!chatCase.case_url;
  useEffect(() => {
    if (!wantsChat || !needsAddress || addressLoading) return;
    let cancelled = false;
    setAddressLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/cases/address", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseNos: [chatCase.case_no] }),
        });
        const body = await res.json().catch(() => ({}));
        const address: string | undefined = body?.addresses?.[chatCase.case_no];
        if (cancelled) return;
        if (address) {
          setChatCase((c) => ({ ...c, full_address: address }));
          onAddressResolved?.(chatCase.case_no, address);
        } else {
          toast.warning("Couldn't fetch the installation address — the chat will show none.");
        }
      } catch (err) {
        console.error("Address fetch failed:", err);
        if (!cancelled) {
          toast.warning("Couldn't fetch the installation address — the chat will show none.");
        }
      } finally {
        if (!cancelled) setAddressLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsChat, needsAddress]);

  const included = useMemo(() => items.filter((i) => !i.unavailable), [items]);

  function toggleType(type: MergeDocType) {
    setTypes((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type]
    );
  }

  function removeItem(id: string) {
    setArranged(true);
    setItems((current) => current.filter((i) => i.id !== id));
  }

  function move(from: number, to: number) {
    setArranged(true);
    setItems((current) => moveMergeItem(current, from, to));
  }

  /** The chat as a one-page A4 PDF, rasterised from the hidden render below. */
  async function captureChatPage(): Promise<Uint8Array> {
    const node = chatRef.current;
    if (!node) throw new Error("The closing script has not rendered.");
    const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: rand.wallpaper });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(base64);
    const png = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return pngToPdfPage(png);
  }

  async function handleMerge() {
    if (included.length === 0 || merging) return;
    setMerging(true);
    setDone(0);

    try {
      // Fetch a few at a time but keep the results index-aligned, so the merged
      // page order is the order on screen rather than the order they arrived.
      const bytes: (Uint8Array | null)[] = new Array(included.length).fill(null);
      let cursor = 0;
      async function worker() {
        while (cursor < included.length) {
          const index = cursor++;
          const item = included[index];
          try {
            const url = mergeItemUrl(item);
            if (url === null) {
              // The closing script: rasterise the hidden render and give it a
              // page of its own, so the merge sees ordinary PDF bytes.
              bytes[index] = await captureChatPage();
            } else {
              const res = await fetch(url);
              if (res.ok) {
                bytes[index] = new Uint8Array(await res.arrayBuffer());
              }
            }
          } catch (err) {
            console.error("merge source failed:", item.label, err);
          }
          setDone((n) => n + 1);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(FETCH_CONCURRENCY, included.length) }, worker)
      );

      const sources: MergeSource[] = [];
      const unreachable: string[] = [];
      included.forEach((item, index) => {
        const b = bytes[index];
        if (b) sources.push({ label: item.label, bytes: b });
        else unreachable.push(item.label);
      });

      if (sources.length === 0) {
        toast.error("None of the selected documents could be downloaded.");
        return;
      }

      const result = await mergePdfs(sources);

      const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `documents_${caseData.case_no}_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Name what was left out. A merged file quietly missing a document looks
      // exactly like one that worked.
      const skipped = [...unreachable, ...result.failed];
      if (skipped.length > 0) {
        toast.warning(
          `Merged ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}, but ${skipped.length} document${skipped.length === 1 ? "" : "s"} couldn't be included: ${skipped.join(", ")}`
        );
      } else {
        toast.success(
          `Merged ${sources.length} document${sources.length === 1 ? "" : "s"} into ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}.`
        );
      }
      onClose();
    } catch (err) {
      console.error("merge failed:", err);
      toast.error(err instanceof Error ? err.message : "Merge failed. Please try again.");
    } finally {
      setMerging(false);
      setDone(0);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !merging && onClose()}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg" aria-describedby="merge-note">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-[#0A2540]">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EEF0FF]"
              aria-hidden="true"
            >
              <MergeIcon className="h-3.5 w-3.5 text-[#635BFF]" />
            </span>
            Merge documents into one PDF
          </DialogTitle>
        </DialogHeader>

        <DialogDescription id="merge-note" className="text-[13px] leading-relaxed text-[#425466]">
          Case {caseData.case_no}{caseData.full_name ? ` · ${caseData.full_name}` : ""}. The
          documents you tick are combined in the order below and downloaded as one PDF — nothing is
          generated, stored or charged.
        </DialogDescription>

        <>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
              <legend className="mb-2 text-xs font-medium text-[#697386]">Include</legend>
              {MERGE_DOC_TYPES.map((type) => (
                <label
                  key={type}
                  className="flex cursor-pointer items-center gap-2 text-[13px] text-[#425466]"
                >
                  <input
                    type="checkbox"
                    className="cursor-pointer rounded border-[#E3E8EF] text-[#635BFF] focus:ring-[#635BFF]/20"
                    checked={types.includes(type)}
                    disabled={merging}
                    onChange={() => toggleType(type)}
                  />
                  {MERGE_DOC_LABELS[type]}
                </label>
              ))}
            </fieldset>

            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-[#E3E8EF] p-1">
              {items.length === 0 && (
                <li className="px-2 py-6 text-center text-xs text-[#697386]">
                  Tick a document type to build the list.
                </li>
              )}
              {items.map((item, index) => (
                <li
                  key={item.id}
                  draggable={!merging && !item.unavailable}
                  onDragStart={() => setDragIndex(index)}
                  onDragEnd={() => setDragIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null) move(dragIndex, index);
                    setDragIndex(null);
                  }}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
                    item.unavailable
                      ? "text-[#8792A2] opacity-70"
                      : "cursor-grab text-[#0A2540] hover:bg-[#F6F9FC]"
                  } ${dragIndex === index ? "bg-[#EEF0FF]" : ""}`}
                >
                  <GripIcon
                    className={`h-3.5 w-3.5 shrink-0 ${item.unavailable ? "invisible" : "text-[#C1C9D2]"}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{MERGE_DOC_LABELS[item.type]}</span>
                  {item.unavailable ? (
                    <span className="shrink-0 text-xs">{item.unavailable}</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-0.5">
                      {/* Drag is not reachable from a keyboard, so ordering has buttons too. */}
                      <button
                        type="button"
                        aria-label={`Move ${item.label} up`}
                        disabled={merging || index === 0}
                        onClick={() => move(index, index - 1)}
                        className="cursor-pointer rounded px-1 text-[#697386] hover:text-[#635BFF] disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${item.label} down`}
                        disabled={merging || index === items.length - 1}
                        onClick={() => move(index, index + 1)}
                        className="cursor-pointer rounded px-1 text-[#697386] hover:text-[#635BFF] disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${item.label}`}
                        disabled={merging}
                        onClick={() => removeItem(item.id)}
                        className="cursor-pointer rounded p-1 text-[#697386] hover:text-[#DF1B41] disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <CloseIcon className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {merging && (
              <div className="space-y-1" aria-live="polite">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E3E8EF]">
                  <div
                    className="h-full rounded-full bg-[#635BFF] transition-all duration-200"
                    style={{ width: `${Math.round((done / Math.max(included.length, 1)) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-[#697386]">
                  Fetching {done} of {included.length} documents…
                </p>
              </div>
            )}
          {addressLoading && (
            <p className="text-xs text-[#697386]" aria-live="polite">
              Fetching the installation address for the closing script…
            </p>
          )}

          {/* Off-screen render the capture reads from. Only mounted when the
              chat is actually wanted — it is a heavy subtree. */}
          {wantsChat && (
            <div style={{ position: "absolute", left: -9999, top: -9999 }} aria-hidden="true">
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
          )}
        </>

        <DialogFooter className="gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={merging}
            className="cursor-pointer rounded-md border border-[#E3E8EF] px-3 py-2 text-[13px] font-medium text-[#425466] transition-colors duration-150 hover:border-[#635BFF] hover:text-[#635BFF] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={merging || addressLoading || included.length === 0}
            className="cursor-pointer rounded-md bg-[#635BFF] px-3 py-2 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-[#0A2540] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {merging ? "Merging…" : `Merge ${included.length} document${included.length === 1 ? "" : "s"}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
