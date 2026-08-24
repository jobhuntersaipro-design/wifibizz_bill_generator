// Browser-only: normalize an uploaded image to PNG bytes.
//
// pdf-lib can embed PNG and JPEG and nothing else, but the order form accepts
// BMP, WEBP and JFIF as well. Without this a BMP would land in mergePdfs'
// `failed` list and be dropped from the combined file — a page quietly missing
// from a merge is the exact failure mergePdfs was written to be loud about, and
// here it would be OUR doing rather than a corrupt source.
//
// The browser already decodes every one of those formats, so the conversion is a
// decode and a canvas re-encode. This runs in the order form, which merges
// client-side, so nothing is uploaded to do it.

/** Decode any browser-supported image and re-encode it as PNG. */
export async function imageBytesToPng(bytes: Uint8Array, mimeType: string): Promise<Uint8Array> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType || "image/png" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    // naturalWidth is 0 for an image the browser refused to decode; drawing it
    // would produce a blank page rather than an error.
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("The image could not be decoded.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable.");
    ctx.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("The image could not be converted.");
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be loaded."));
    image.src = url;
  });
}

/** Content type for an uploaded filename, for the decode step above. */
export function contentTypeFor(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg" || ext === "jfif") return "image/jpeg";
  if (ext === "bmp") return "image/bmp";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}
