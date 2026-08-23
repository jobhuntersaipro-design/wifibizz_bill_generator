/**
 * Replacement artwork for the payment slip's barcodes and QR codes.
 *
 * The template's barcodes and QR codes encode the ORIGINAL account number,
 * invoice number and amount. They are drawn as vector rectangles and as a
 * bitmap, so no text substitution reaches them: a generated invoice would print
 * new numbers beside artwork still asserting the old ones.
 *
 * Per the 2026-08-23 decision they are replaced with random patterns. **The
 * result is decoration: it does not scan, and is not meant to.** This was chosen
 * over encoding the real values and over blanking the artwork out.
 *
 * The geometry below was measured out of the template's own streams, so the
 * replacements occupy exactly the space the originals did and neither the BBox
 * nor the page's placement matrix has to change.
 */

/** A seeded generator, so one case always produces the same artwork. */
export type Rng = () => number;

// ── The "e-invoice" QR: a vector Form XObject (Xf1) ────────────────
// 686 filled 4×4 rects on a grid spanning x 62–210, y 16–164 — a 37-module
// square, which is a real QR size (version 5).
export const QR_FORM = {
  originX: 62,
  originY: 16,
  moduleSize: 4,
  modules: 37,
} as const;

// ── The three payment-slip barcodes (Xf2, Xf3, Xf4) ────────────────
// Bars 26.66 tall sitting on y=2.67, starting at x=7.94. Observed bar widths are
// multiples of about 1.2pt, which is what a Code 128 module measures here.
export const BARCODE = {
  x0: 7.94,
  y: 2.67,
  height: 26.66,
  module: 1.2,
} as const;

/** The right-hand extent of each barcode, measured from the template. */
export const BARCODE_EXTENTS: Record<string, number> = {
  Xf2: 268.9,
  Xf3: 250.31,
  Xf4: 250.31,
};

// ── The "Pay here" QR: a 53×51 RGB bitmap (img3) ───────────────────
export const QR_BITMAP = { width: 53, height: 51 } as const;

/**
 * A random module grid carrying the three finder patterns a QR code has in its
 * corners. The finders are what make it read as a QR at a glance; the payload
 * area is noise, which is why it decodes to nothing.
 */
export function randomQrModules(size: number, rng: Rng): boolean[][] {
  const grid: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => rng() < 0.5),
  );

  const drawFinder = (top: number, left: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const ring = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[top + r][left + c] = ring || core;
      }
    }
    // The one-module quiet band that separates a finder from the payload.
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = top + r;
        const cc = left + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        if (r === -1 || r === 7 || c === -1 || c === 7) grid[rr][cc] = false;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  return grid;
}

/**
 * Draw a module grid as a PDF content stream of filled rectangles.
 *
 * Row 0 is the top row, so it is drawn at the high end of the box — PDF's y axis
 * runs upward and a QR read upside down is a different pattern.
 */
export function qrFormContent(grid: boolean[][]): string {
  const { originX, originY, moduleSize } = QR_FORM;
  const size = grid.length;
  let out = '0 0 0 rg\n';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r][c]) continue;
      const x = originX + c * moduleSize;
      const y = originY + (size - 1 - r) * moduleSize;
      out += `${x} ${y} ${moduleSize} ${moduleSize} re f\n`;
    }
  }
  return out;
}

/**
 * Random bars spanning the same width as the barcode being replaced.
 *
 * Bars and spaces alternate with widths of one to four modules, the shape a real
 * Code 128 symbol has. It stops on a bar and never overruns the measured extent.
 */
export function barcodeContent(extentX: number, rng: Rng): string {
  const { x0, y, height, module } = BARCODE;
  let out = '0 0 0 rg\n';
  let x = x0;
  let isBar = true;

  while (x < extentX) {
    const width = module * (1 + Math.floor(rng() * 4));
    if (isBar) {
      const drawn = Math.min(width, extentX - x);
      if (drawn <= 0) break;
      out += `${round2(x)} ${y} ${round2(drawn)} ${height} re f\n`;
    }
    x += width;
    isBar = !isBar;
  }

  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Raw RGB pixels for the bitmap QR, one byte per channel, row-major from the top
 * — the layout the template's image object already declares.
 *
 * The pattern is generated at module-per-pixel resolution inside a white quiet
 * zone, so it fills the same square the original did.
 */
export function qrBitmapRgb(rng: Rng): Buffer {
  const { width, height } = QR_BITMAP;
  const quiet = 2;
  const size = Math.min(width, height) - quiet * 2;
  const grid = randomQrModules(size, rng);

  const buf = Buffer.alloc(width * height * 3, 0xff);
  const offsetX = Math.floor((width - size) / 2);
  const offsetY = Math.floor((height - size) / 2);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r][c]) continue;
      const px = ((offsetY + r) * width + (offsetX + c)) * 3;
      buf[px] = 0;
      buf[px + 1] = 0;
      buf[px + 2] = 0;
    }
  }

  return buf;
}
