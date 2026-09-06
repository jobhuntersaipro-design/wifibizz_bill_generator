import { PDFDocument } from "pdf-lib";

/**
 * Putting a captured image onto a PDF page.
 *
 * The closing-script chat is not a document with an endpoint — it is a DOM node
 * rasterised to PNG, 414×1035 at capture size, a 1:2.5 column no page is shaped
 * like. To travel in the combined PDF alongside the bills it gets a page of its
 * own: A4, image centred and scaled to fit inside a margin, aspect preserved.
 */

/** A4 in points, the size the letter and TIME invoice already use. */
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
/** White space kept clear on every side. */
export const IMAGE_PAGE_MARGIN = 40;

export interface Placement {
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Scale `image` to fit inside `box` without distorting it, and centre it.
 *
 * Scales down only: an image smaller than the box keeps its own size rather than
 * being blown up into a blurry full-page render.
 */
export function fitWithin(
  imageWidth: number,
  imageHeight: number,
  boxWidth: number,
  boxHeight: number,
  pageWidth: number,
  pageHeight: number
): Placement {
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("Image has no size.");
  }
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight, 1);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    width,
    height,
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
  };
}

/**
 * A one-page A4 PDF holding `png`, centred and fitted.
 *
 * Returns bytes so the result is just another source to `mergePdfs`, which keeps
 * the merge itself unaware that one of its inputs was a screenshot.
 */
export async function imageToPdfPage(
  bytes: Uint8Array,
  mime: "image/png" | "image/jpeg",
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  const image =
    mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const placement = fitWithin(
    image.width,
    image.height,
    A4_WIDTH - IMAGE_PAGE_MARGIN * 2,
    A4_HEIGHT - IMAGE_PAGE_MARGIN * 2,
    A4_WIDTH,
    A4_HEIGHT
  );
  page.drawImage(image, placement);
  return doc.save();
}

export async function pngToPdfPage(png: Uint8Array): Promise<Uint8Array> {
  return imageToPdfPage(png, "image/png");
}
