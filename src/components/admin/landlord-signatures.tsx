"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  adminDeleteLandlordSignature,
  adminListLandlordSignatures,
  adminUploadLandlordSignature,
  type LandlordSignatureView,
} from "@/actions/landlord-signatures";

export function LandlordSignatures({
  initialImages,
}: {
  initialImages: LandlordSignatureView[];
}) {
  const [images, setImages] = useState<LandlordSignatureView[]>(initialImages);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const res = await adminListLandlordSignatures();
    if (!res.success) {
      toast.error(res.error ?? "Could not load signatures.");
      return;
    }
    setImages(res.images);
  }

  async function onUpload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.set("file", file);
    const res = await adminUploadLandlordSignature(form);
    setUploading(false);
    if (!res.success) {
      toast.error(res.error ?? "Upload failed.");
      return;
    }
    toast.success("Signature added to the pool.");
    await refresh();
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onDelete(id: string) {
    setDeletingId(id);
    const res = await adminDeleteLandlordSignature(id);
    setDeletingId(null);
    if (!res.success) {
      toast.error(res.error ?? "Delete failed.");
      return;
    }
    toast.success("Signature removed.");
    setImages((current) => current.filter((image) => image.id !== id));
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-[#E3E8EF] bg-white p-5">
        <label className="block">
          <span className="block text-[11px] font-medium text-[#425466] mb-2">
            Upload a landlord signature
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,.png,.jpg,.jpeg"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onUpload(file);
            }}
            className="block w-full text-[12px] text-[#425466] file:mr-3 file:rounded-lg file:border-0 file:bg-[#635BFF] file:px-3 file:py-2 file:text-[12px] file:font-medium file:text-white hover:file:bg-[#5348e0] disabled:opacity-60"
          />
        </label>
        <p className="mt-2 text-[12px] text-[#697386]">
          PNG or JPEG, max 5MB. TA and Auth Letter pick one at random and pair it
          to the invented landlord. An empty pool still generates — the signature
          line stays blank.
        </p>
      </div>

      {images.length === 0 ? (
        <p className="text-sm text-[#697386]">
          No signatures yet. Documents still generate with a blank landlord signature.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image) => (
            <li
              key={image.id}
              className="overflow-hidden rounded-lg border border-[#E3E8EF] bg-white"
            >
              <div className="flex h-44 items-center justify-center bg-[#F6F9FC]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.previewUrl}
                  alt={image.filename}
                  className="max-h-44 max-w-full object-contain"
                />
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <p className="truncate text-[12px] text-[#425466]" title={image.filename}>
                  {image.filename}
                </p>
                <button
                  type="button"
                  disabled={deletingId === image.id}
                  onClick={() => void onDelete(image.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-[#DF1B41] hover:bg-red-50 disabled:opacity-60"
                >
                  {deletingId === image.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
