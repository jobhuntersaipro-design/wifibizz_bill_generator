/**
 * Glyph advance widths for the two fonts the utility bill template embeds.
 *
 * Extracted verbatim from the template PDF's own /Widths arrays
 * (bill_generator/template/utility_bill_template.pdf, objects 57 and 59), so these are
 * the widths the PDF viewer itself uses to lay the text out — not an approximation.
 *
 * Units are 1/1000 em. Both fonts are /WinAnsiEncoding with /FirstChar 32, so index
 * `charCode - 32`. Widths matter because the address block is masked with `X`, which is
 * 685/1000 em in Tahoma-Bold against 313 for a space: counting characters instead of
 * measuring width is what let the mask run past its knock-out box.
 */

const FIRST_CHAR = 32;

const TAHOMA_BOLD_WIDTHS: number[] = [
  293, 343, 489, 818, 637, 1199, 781, 275, 454, 454, 637, 818, 313, 431, 313, 577,
  637, 637, 637, 637, 637, 637, 637, 637, 637, 637, 363, 363, 818, 818, 818, 566,
  920, 685, 686, 667, 757, 615, 581, 745, 764, 483, 500, 696, 572, 893, 771, 770,
  657, 770, 726, 633, 612, 739, 675, 1028, 685, 670, 623, 454, 577, 454, 818, 637,
  546, 599, 632, 527, 629, 594, 382, 629, 640, 302, 363, 603, 302, 954, 640, 617,
  629, 629, 434, 515, 416, 640, 579, 890, 604, 576, 526, 623, 637, 623, 818, 1000,
  1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000,
  1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000,
  293, 343, 637, 637, 637, 637, 637, 637, 546, 929, 508, 703, 818, 431, 929, 637,
  520, 818, 539, 539, 546, 651, 637, 363, 546, 539, 539, 703, 1128, 1128, 1128, 566,
  685, 685, 685, 685, 685, 685, 989, 667, 615, 615, 615, 615, 483, 483, 483, 483,
  774, 771, 770, 770, 770, 770, 770, 818, 770, 739, 739, 739, 739, 670, 659, 646,
  599, 599, 599, 599, 599, 599, 937, 527, 594, 594, 594, 594, 302, 302, 302, 302,
  620, 640, 617, 617, 617, 617, 617, 818, 617, 640, 640, 640, 640, 576, 629, 576,
];

const TAHOMA_WIDTHS: number[] = [
  313, 332, 401, 728, 546, 977, 674, 211, 383, 383, 546, 728, 303, 363, 303, 382,
  546, 546, 546, 546, 546, 546, 546, 546, 546, 546, 354, 354, 728, 728, 728, 474,
  909, 600, 589, 601, 678, 561, 521, 667, 675, 373, 417, 588, 498, 771, 667, 708,
  551, 708, 621, 557, 584, 656, 597, 902, 581, 576, 559, 383, 382, 383, 728, 546,
  546, 525, 553, 461, 553, 526, 318, 553, 558, 229, 282, 498, 229, 840, 558, 543,
  553, 553, 360, 446, 334, 558, 498, 742, 495, 498, 444, 480, 382, 480, 728, 1000,
  1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000,
  1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000,
  313, 332, 546, 546, 546, 546, 382, 546, 546, 929, 493, 573, 728, 363, 929, 546,
  471, 728, 493, 493, 546, 568, 546, 354, 546, 493, 493, 573, 1000, 1000, 1000, 474,
  600, 600, 600, 600, 600, 600, 913, 601, 561, 561, 561, 561, 373, 373, 373, 373,
  698, 667, 708, 708, 708, 708, 708, 728, 708, 656, 656, 656, 656, 576, 565, 548,
  525, 525, 525, 525, 525, 525, 880, 461, 526, 526, 526, 526, 229, 229, 229, 229,
  546, 558, 543, 543, 543, 543, 543, 728, 543, 558, 558, 558, 558, 498, 553, 498,
];

export type BillFont = "/F0201" | "/F0301";

/** /F0201 is Tahoma-Bold (the name line), /F0301 is Tahoma (the address lines). */
const WIDTHS_BY_FONT: Record<BillFont, number[]> = {
  "/F0201": TAHOMA_BOLD_WIDTHS,
  "/F0301": TAHOMA_WIDTHS,
};

/**
 * Width of `text` in points when drawn in `font` at `fontSize`.
 *
 * Characters outside WinAnsi's 32..255 range fall back to the width of a space rather
 * than being skipped: overlay text is encoded latin1 downstream, so an unmeasurable
 * character still occupies a slot on the page.
 */
export function measureText(text: string, font: BillFont, fontSize: number): number {
  const widths = WIDTHS_BY_FONT[font];
  let total = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    const idx = code - FIRST_CHAR;
    total += idx >= 0 && idx < widths.length ? widths[idx] : widths[0];
  }
  return (total * fontSize) / 1000;
}

/** How many repeats of `ch` fit within `maxWidth` at the given font and size. */
export function fitRepeatCount(ch: string, font: BillFont, fontSize: number, maxWidth: number): number {
  const one = measureText(ch, font, fontSize);
  if (one <= 0) return 0;
  return Math.max(1, Math.floor(maxWidth / one));
}
