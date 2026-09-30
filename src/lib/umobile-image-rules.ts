/**
 * Rules for a file offered to the Umobile modem-image pool.
 *
 * Shared by the admin gallery (to reject a file before it is sent, with a named reason)
 * and the upload action (which checks again, because a Server Action is directly
 * POST-able and the browser's word is not proof).
 */

export const UMOBILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** How many tiles one gallery page shows. */
export const UMOBILE_GALLERY_PAGE_SIZE = 12;

export type UmobileImageMime = "image/png" | "image/jpeg";

export const UMOBILE_IMAGE_EXT: Record<string, UmobileImageMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Why a file cannot join the pool, or null when it may be sent. */
export function umobileImageFileError(file: { name: string; size: number }): string | null {
  if (!UMOBILE_IMAGE_EXT[fileExtension(file.name)]) return "Not a PNG or JPEG image.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > UMOBILE_IMAGE_MAX_BYTES) {
    return `${(file.size / (1024 * 1024)).toFixed(1)}MB — over the 5MB limit.`;
  }
  return null;
}

/**
 * The image type the bytes actually hold, or null.
 *
 * The extension alone let a renamed file into the pool, and the bill generator then
 * skipped its modem page silently when the embed failed. Stored content type comes from
 * here, so a JPEG named `.png` is stored as the JPEG it is.
 */
export function sniffImageMime(bytes: Uint8Array): UmobileImageMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}
