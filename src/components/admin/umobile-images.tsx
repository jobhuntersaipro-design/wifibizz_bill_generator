"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ImagePlus, Trash2, X } from "lucide-react";
import {
  adminDeleteUmobileImage,
  adminUploadUmobileImage,
  type UmobileImageView,
} from "@/actions/umobile-images";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clampPage, pageCount, pageNumbers, pageSlice } from "@/lib/paginate";
import { createdParts } from "@/lib/order-types";
import { UMOBILE_GALLERY_PAGE_SIZE, umobileImageFileError } from "@/lib/umobile-image-rules";

type UploadStatus = "queued" | "uploading" | "done" | "error";

interface UploadItem {
  key: string;
  name: string;
  status: UploadStatus;
  error?: string;
}

const PER_PAGE = UMOBILE_GALLERY_PAGE_SIZE;

export function UmobileImages({ initialImages }: { initialImages: UmobileImageView[] }) {
  const [images, setImages] = useState<UmobileImageView[]>(initialImages);
  const [page, setPage] = useState(1);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UmobileImageView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<UmobileImageView | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pages = pageCount(images.length, PER_PAGE);
  const current = clampPage(page, images.length, PER_PAGE);
  const visible = pageSlice(images, current, PER_PAGE);

  function patchUpload(key: string, patch: Partial<UploadItem>) {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  }

  /**
   * Every file gets a row with its own result. A file that breaks a rule is refused
   * before it is sent, named with the reason; the rest still go, one at a time, and each
   * lands in the gallery as it finishes.
   */
  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0 || busy) return;
    const batch = files.map((file, i) => {
      const error = umobileImageFileError(file);
      return {
        file,
        item: {
          key: `${Date.now()}-${i}-${file.name}`,
          name: file.name,
          status: (error ? "error" : "queued") as UploadStatus,
          error: error ?? undefined,
        },
      };
    });
    setUploads(batch.map((b) => b.item));
    setBusy(true);

    let added = 0;
    for (const { file, item } of batch) {
      if (item.status === "error") continue;
      patchUpload(item.key, { status: "uploading" });
      const form = new FormData();
      form.set("file", file);
      try {
        const res = await adminUploadUmobileImage(form);
        if (res.success && res.image) {
          const image = res.image;
          setImages((list) => [image, ...list]);
          patchUpload(item.key, { status: "done" });
          added++;
        } else {
          patchUpload(item.key, { status: "error", error: res.error ?? "Upload failed." });
        }
      } catch {
        patchUpload(item.key, { status: "error", error: "Upload failed. Try again." });
      }
    }

    setBusy(false);
    setPage(1);
    if (inputRef.current) inputRef.current.value = "";
    const failed = batch.length - added;
    if (added && !failed) toast.success(`${added} image${added === 1 ? "" : "s"} added to the pool.`);
    else if (added) toast.warning(`${added} added, ${failed} not uploaded — see the list above.`);
    else toast.error("Nothing was uploaded — see the list above.");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await adminDeleteUmobileImage(deleteTarget.id);
    setDeleting(false);
    if (!res.success) {
      toast.error(res.error ?? "Delete failed.");
      return;
    }
    const id = deleteTarget.id;
    setImages((list) => list.filter((image) => image.id !== id));
    setDeleteTarget(null);
    toast.success("Image removed.");
  }

  const doneCount = uploads.filter((u) => u.status === "done").length;

  return (
    <div className="space-y-5">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void uploadFiles(event.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed bg-white p-6 text-center transition-colors ${
          dragOver ? "border-[#635BFF] bg-[#F5F4FF]" : "border-[#E3E8EF]"
        }`}
      >
        <ImagePlus className="mx-auto h-7 w-7 text-[#635BFF]" aria-hidden="true" />
        <p className="mt-2 text-[13px] font-medium text-[#0A2540]">
          Drop modem photos here, or{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="font-semibold text-[#635BFF] underline-offset-2 hover:underline disabled:opacity-60"
          >
            choose files
          </button>
        </p>
        <p className="mt-1 text-[12px] text-[#697386]">
          PNG or JPEG, max 5MB each. Select as many as you like. Umobile bills pick one at
          random from this pool.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          className="sr-only"
          aria-label="Choose modem images to upload"
          onChange={(event) => {
            if (event.target.files) void uploadFiles(event.target.files);
          }}
        />
      </div>

      {uploads.length > 0 && (
        <div className="rounded-lg border border-[#E3E8EF] bg-white">
          <div className="flex items-center justify-between border-b border-[#E3E8EF] px-4 py-2.5">
            <p className="text-[12px] font-medium text-[#425466]">
              {busy ? "Uploading…" : "Upload finished"} · {doneCount} of {uploads.length} added
            </p>
            {!busy && (
              <button
                type="button"
                onClick={() => setUploads([])}
                className="rounded-md p-1 text-[#697386] hover:bg-[#F6F9FC]"
                aria-label="Dismiss upload results"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <ul className="max-h-56 divide-y divide-[#E3E8EF] overflow-y-auto">
            {uploads.map((u) => (
              <li key={u.key} className="flex items-center justify-between gap-3 px-4 py-2 text-[12px]">
                <span className="min-w-0 truncate text-[#0A2540]" title={u.name}>
                  {u.name}
                </span>
                <UploadBadge item={u} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-medium text-[#0A2540] tabular-nums">
          {images.length} image{images.length === 1 ? "" : "s"}
        </p>
        {pages > 1 && (
          <p className="text-[12px] text-[#697386] tabular-nums">
            Page {current} of {pages}
          </p>
        )}
      </div>

      {images.length === 0 ? (
        <div className="rounded-lg border border-[#E3E8EF] bg-white px-6 py-12 text-center">
          <p className="text-[13px] font-medium text-[#0A2540]">No images in the pool</p>
          <p className="mt-1 text-[12px] text-[#697386]">
            Bills still generate without a modem photo until one is added.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((image) => (
            <li
              key={image.id}
              className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-[#E3E8EF] bg-white"
            >
              <button
                type="button"
                onClick={() => setPreview(image)}
                className="relative block aspect-square w-full bg-[#F6F9FC] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#635BFF]"
                aria-label={`Preview ${image.filename}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.previewUrl}
                  alt={image.filename}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-contain p-2"
                />
              </button>
              <div className="flex items-center justify-between gap-2 border-t border-[#E3E8EF] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-[#0A2540]" title={image.filename}>
                    {image.filename}
                  </p>
                  <p className="text-[11px] text-[#697386] tabular-nums">
                    {createdParts(image.createdAt)?.date ?? "—"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(image)}
                  className="shrink-0 rounded-md p-1.5 text-[#DF1B41] hover:bg-red-50"
                  aria-label={`Delete ${image.filename}`}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-1" aria-label="Gallery pages">
          <PageButton label="Previous page" disabled={current <= 1} onClick={() => setPage(current - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </PageButton>
          {pageNumbers(current, pages).map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} className="px-1 text-[12px] text-[#697386]">
                …
              </span>
            ) : (
              <PageButton
                key={p}
                label={`Page ${p}`}
                current={p === current}
                onClick={() => setPage(p)}
              >
                {p}
              </PageButton>
            ),
          )}
          <PageButton label="Next page" disabled={current >= pages} onClick={() => setPage(current + 1)}>
            <ChevronRight className="h-4 w-4" />
          </PageButton>
        </nav>
      )}

      {preview && (
        <Dialog open onOpenChange={(open) => !open && setPreview(null)}>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle className="truncate pr-8 text-[14px] font-semibold text-[#0A2540]">
                {preview.filename}
              </DialogTitle>
              <DialogDescription className="text-[12px] text-[#697386]">
                Uploaded {createdParts(preview.createdAt)?.date ?? "—"}
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[70vh] items-center justify-center rounded-lg bg-[#F6F9FC] p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.previewUrl}
                alt={preview.filename}
                className="max-h-[66vh] max-w-full object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {deleteTarget && (
        <Dialog open onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
          <DialogContent showCloseButton={false} className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-[15px] font-semibold text-[#0A2540]">
                Delete this image?
              </DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-[13px] leading-relaxed text-[#425466]">
              <span className="font-semibold text-[#0A2540]">{deleteTarget.filename}</span> will
              be removed from the pool. Bills already generated keep their copy; new bills can no
              longer pick it.
            </DialogDescription>
            <DialogFooter>
              <DialogClose
                disabled={deleting}
                className="rounded-lg border border-[#E3E8EF] px-3 py-2 text-[13px] font-medium text-[#425466] hover:bg-[#F6F9FC]"
              >
                Cancel
              </DialogClose>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className="rounded-lg bg-[#DF1B41] px-3 py-2 text-[13px] font-medium text-white hover:bg-[#c8163a] disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete image"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function UploadBadge({ item }: { item: UploadItem }) {
  if (item.status === "error") {
    return <span className="shrink-0 text-right text-[#DF1B41]">{item.error}</span>;
  }
  const label = { queued: "Waiting", uploading: "Uploading…", done: "Added" }[item.status];
  const color = item.status === "done" ? "text-[#0E8A5F]" : "text-[#697386]";
  return <span className={`shrink-0 ${color}`}>{label}</span>;
}

function PageButton({
  children,
  label,
  current = false,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  current?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-[13px] tabular-nums transition-colors disabled:opacity-40 ${
        current ? "bg-[#635BFF] font-semibold text-white" : "text-[#425466] hover:bg-[#F6F9FC]"
      }`}
    >
      {children}
    </button>
  );
}
