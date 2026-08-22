/**
 * The signature above each signature line.
 *
 * It is drawn, not typed. Earlier versions set the signer's name in a script
 * face; the result was legible, correct and unmistakably typeset, because a
 * typeface can only ever produce well-formed letterforms evenly spaced. What a
 * signature actually is, is one continuous gesture of the pen — an opening
 * flourish, a run of oscillations that stop resembling letters about a third of
 * the way in, and a long exit. That is what this generates.
 *
 * The path is seeded on the signer's name, so one person always signs the same
 * way and two people on one letter almost never sign alike. Nothing in the
 * output spells the name, which is true of most people's signatures.
 */

import { degrees, rgb, type PDFPage } from 'pdf-lib';
import { hashSeed, makeRng } from './owner-identity';

/** How far below the signature line a flourish may reach, in points. */
export const FLOURISH_DESCENT = 24;

/**
 * How far above the line the mark may reach, as a multiple of the cap height it
 * was given. The opening gesture is the tall part — roughly two and a half cap
 * heights — and a caller that reserves only the cap height gets a flourish drawn
 * through the heading above it.
 */
export const SIGNATURE_ASCENT = 2.7;

export interface SignatureOptions {
  /** Left edge, in PDF points. */
  x: number;
  /** Baseline the signature sits on, in PDF points. */
  y: number;
  width?: number;
  /** Cap height of the writing — the flourishes scale off it. */
  height?: number;
}

/** Up to two initials. Kept for callers that label rather than draw. */
export function initialsOf(name: string): string[] {
  return (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .filter((c) => /[A-Z]/.test(c))
    .slice(0, 2);
}

/**
 * A pen tracing one path. Coordinates are kept the way a person would describe
 * them — x rightward, y UPWARD from the baseline — and flipped once on output,
 * because pdf-lib reads an SVG path with y growing downward. Doing the flip per
 * control point is how earlier drafts ended up with loops that curled the wrong
 * way.
 */
class Pen {
  private readonly parts: string[] = [];
  x = 0;
  y = 0;

  /**
   * `lean` shears the whole path: every point is pushed right in proportion to
   * its height. This is the single thing that makes a chain of arcs read as
   * handwriting rather than as a waveform — cursive leans, and a rotation of the
   * whole mark is not the same thing, because that tips the baseline too.
   */
  constructor(x: number, y: number, private readonly lean: number) {
    this.x = x;
    this.y = y;
    this.parts.push(`M ${f(this.shear(x, y))} ${f(-y)}`);
  }

  private shear(x: number, y: number): number {
    return x + this.lean * y;
  }

  /** One cubic, given both control points and the end point. */
  curve(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.parts.push(
      `C ${f(this.shear(c1x, c1y))} ${f(-c1y)} ${f(this.shear(c2x, c2y))} ${f(-c2y)} ${f(this.shear(x, y))} ${f(-y)}`
    );
    this.x = x;
    this.y = y;
  }

  toString(): string {
    return this.parts.join(' ');
  }
}

function f(n: number): string {
  return n.toFixed(2);
}

/**
 * One stroke of the middle run. Each starts and ends near the baseline, which is
 * where cursive joins, so they chain into a single unbroken line.
 *
 * `slope` is the baseline drift at this point — writing climbs or falls across
 * the width, and a run drawn dead level is the single strongest tell that a
 * shape was computed rather than written.
 */
type Stroke = (pen: Pen, w: number, h: number, rng: () => number, slope: number) => void;

/**
 * How often each shape turns up. Uniform choice filled the run with ascenders
 * and spikes, which produced a row of tall thin verticals — an EKG trace, not a
 * signature. Real cursive is mostly shoulders and bowls with the occasional tall
 * stroke through it.
 */
const STROKE_WEIGHTS = [4, 3, 1.2, 1, 2.5, 0.5];

const STROKES: Stroke[] = [
  // Arch — the shoulder of an n or m.
  (pen, w, h, rng, slope) => {
    const x = pen.x;
    const j = () => (rng() - 0.5) * 0.18;
    pen.curve(
      x + w * (0.12 + j()), h * (1.05 + j()),
      x + w * (0.82 + j()), h * (1.12 + j()),
      x + w, slope + h * 0.04
    );
  },
  // Cup — a u, dipping just under the line.
  (pen, w, h, rng, slope) => {
    const x = pen.x;
    const j = () => (rng() - 0.5) * 0.2;
    pen.curve(
      x + w * (0.18 + j()), -Math.min(h * (0.22 + j() * 0.4), FLOURISH_DESCENT * 0.3),
      x + w * (0.8 + j()), -Math.min(h * (0.18 + j() * 0.4), FLOURISH_DESCENT * 0.3),
      x + w, slope + h * 0.12
    );
  },
  // Ascender loop — tall and narrow, crossing itself. The control points run in
  // reversed x order; that reversal is the crossing.
  (pen, w, h, rng, slope) => {
    const x = pen.x;
    const j = () => (rng() - 0.5) * 0.22;
    const top = Math.min(h * (1.9 + j()), h * SIGNATURE_ASCENT);
    pen.curve(
      x + w * (0.6 + j()), top,
      x - w * (0.15 + j()), top * 0.92,
      x + w * 0.62, slope + h * 0.06
    );
    pen.curve(
      x + w * 0.78, slope - h * 0.06,
      x + w * 0.88, slope + h * 0.3,
      x + w, slope + h * 0.1
    );
  },
  // Descender loop — a g or y, thrown below the line. Its depth is capped
  // against the same budget the flourishes respect: a descender is the one part
  // of the writing that reaches under the line, and left uncapped it lands on
  // the IC number just as surely as a serpentine would.
  (pen, w, h, rng, slope) => {
    const x = pen.x;
    const j = () => (rng() - 0.5) * 0.2;
    const depth = Math.min(h, FLOURISH_DESCENT * 0.72);
    pen.curve(
      x + w * (0.55 + j()), -depth * (0.85 + j()),
      x - w * (0.1 + j()), -depth * (1.0 + j() * 0.5),
      x + w * 0.5, slope + h * 0.05
    );
    pen.curve(
      x + w * 0.7, slope + h * 0.35,
      x + w * 0.85, slope - h * 0.05,
      x + w, slope + h * 0.14
    );
  },
  // Oval — the counter of an o or a, closed by coming back over itself.
  (pen, w, h, rng, slope) => {
    const x = pen.x;
    const j = () => (rng() - 0.5) * 0.16;
    pen.curve(
      x + w * (0.05 + j()), h * (0.8 + j()),
      x + w * (0.95 + j()), h * (0.85 + j()),
      x + w * 0.62, slope + h * 0.12
    );
    pen.curve(
      x + w * 0.35, slope - h * 0.12,
      x + w * 0.85, slope + h * 0.4,
      x + w, slope + h * 0.18
    );
  },
  // Spike — the quick vertical of a t or f, with no loop at the top.
  (pen, w, h, rng, slope) => {
    const x = pen.x;
    const j = () => (rng() - 0.5) * 0.15;
    pen.curve(
      x + w * (0.34 + j()), h * 0.7,
      x + w * (0.3 + j()), h * (1.6 + j()),
      x + w * 0.48, slope + h * (1.5 + j())
    );
    pen.curve(
      x + w * 0.62, slope + h * 0.85,
      x + w * 0.7, slope + h * 0.08,
      x + w, slope + h * 0.06
    );
  },
];

/**
 * The opening gesture — the large capital everything else trails away from.
 *
 * Heights are clamped to `SIGNATURE_ASCENT`, so the constant the caller reserves
 * room against is enforced here rather than assumed.
 */
const OPENINGS: Stroke[] = [
  // A tall thrown loop that crosses low.
  (pen, w, h, rng) => {
    const x = pen.x;
    const top = Math.min(h * (2.1 + rng() * 0.4), h * SIGNATURE_ASCENT);
    pen.curve(x + w * 0.62, top, x - w * 0.42, top * 0.88, x + w * 0.38, h * 0.05);
    pen.curve(x + w * 0.62, -h * 0.18, x + w * 0.9, h * 0.55, x + w, h * 0.22);
  },
  // A wide oval, closed by a stroke back across its own face.
  (pen, w, h, rng) => {
    const x = pen.x;
    const top = Math.min(h * (1.55 + rng() * 0.3), h * SIGNATURE_ASCENT);
    pen.curve(x - w * 0.22, top * 0.84, x + w * 1.05, top, x + w * 0.52, h * 0.1);
    pen.curve(x + w * 0.15, -h * 0.2, x + w * 0.15, h * 0.9, x + w, h * 0.35);
  },
  // A long climb into a hook — the capital of someone in a hurry.
  (pen, w, h, rng) => {
    const x = pen.x;
    const top = Math.min(h * (1.9 + rng() * 0.5), h * SIGNATURE_ASCENT);
    pen.curve(x + w * 0.3, h * 0.9, x + w * 0.36, top, x + w * 0.56, top * 0.92);
    pen.curve(x + w * 0.74, top * 0.85, x + w * 0.42, h * 0.1, x + w, h * 0.28);
  },
];

function pickStroke(rng: () => number): Stroke {
  const total = STROKE_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < STROKES.length; i++) {
    r -= STROKE_WEIGHTS[i];
    if (r <= 0) return STROKES[i];
  }
  return STROKES[0];
}

interface Hand {
  slant: number;
  /** Italic shear — how far the writing leans as it rises. */
  lean: number;
  /** Baseline climb or fall across the whole signature, in points. */
  drift: number;
  /** Cap height of the middle run. */
  height: number;
  /** How many strokes the middle run has. */
  strokes: number;
  /** How far the run shrinks by the end — writing degenerates as it speeds up. */
  decay: number;
  opening: number;
  flourish: number;
  strike: boolean;
  nib: number;
}

function handFor(name: string, height: number): { hand: Hand; rng: () => number } {
  const rng = makeRng(hashSeed(`hand:${name}`));
  return {
    rng,
    hand: {
      // Small: the lean does the leaning, and rotating the whole mark as well
      // tips the baseline off the signature line.
      slant: (rng() - 0.5) * 5,
      lean: 0.2 + rng() * 0.28,
      drift: (rng() - 0.4) * 6,
      height: height * (0.8 + rng() * 0.25),
      strokes: 3 + Math.floor(rng() * 4),
      decay: 0.3 + rng() * 0.35,
      opening: Math.floor(rng() * OPENINGS.length),
      flourish: rng(),
      strike: rng() < 0.4,
      // Hairline. Weight was most of why the typeset versions read as a font.
      nib: 0.5 + rng() * 0.35,
    },
  };
}

/**
 * The written part: opening gesture, then the run, then a long exit. One
 * unbroken path, because the pen is not lifted until the end.
 */
function buildWriting(hand: Hand, rng: () => number, runWidth: number): string {
  const pen = new Pen(0, hand.height * 0.12, hand.lean);
  const h = hand.height;

  // A low approach into the opening, the way a hand arrives at the paper.
  pen.curve(runWidth * 0.03, h * 0.3, runWidth * 0.04, -h * 0.1, runWidth * 0.07, 0);

  const openWidth = runWidth * (0.24 + rng() * 0.1);
  OPENINGS[hand.opening](pen, openWidth, h, rng, 0);

  const runSpan = runWidth - pen.x;
  // Wide enough not to be a spike: a shoulder is about as wide as it is tall,
  // and dividing the run evenly among many strokes is what produced verticals.
  const each = Math.max(runSpan / hand.strokes, h * 0.62);

  for (let i = 0; i < hand.strokes; i++) {
    const t = i / Math.max(hand.strokes - 1, 1);
    // Amplitude falls away and the baseline drifts: by the end the strokes have
    // stopped pretending to be letters, which is where a signature stops being
    // readable.
    const strokeHeight = h * (1 - hand.decay * t) * (0.8 + rng() * 0.45);
    const strokeWidth = each * (0.75 + rng() * 0.55);
    const slope = hand.drift * t;
    pickStroke(rng)(pen, strokeWidth, strokeHeight, rng, slope);
  }

  return pen.toString();
}

export interface SignaturePath {
  path: string;
  /** Relative pen weight — the strike-through is one fast pass, so it is thinner. */
  widthScale: number;
}

export interface SignatureDrawing {
  paths: SignaturePath[];
  nib: number;
  slant: number;
}

/**
 * The whole signature as plain path data, before anything is drawn.
 *
 * Separated from the drawing so the shapes can be examined directly. Reading
 * them back out of a saved PDF is not a real option — pdf-lib packs objects on
 * save, so a test that greps the bytes proves nothing about the geometry.
 */
export function signaturePaths(name: string, opts: SignatureOptions): SignatureDrawing {
  const total = opts.width ?? 142;
  const { hand, rng } = handFor(name, opts.height ?? 22);

  const paths: SignaturePath[] = [];
  const push = (path: string, widthScale = 1) => paths.push({ path, widthScale });

  // The writing occupies most, but not all, of the box: the flourish needs room
  // to run past it.
  const runWidth = total * (0.62 + rng() * 0.14);
  push(buildWriting(hand, rng, runWidth));
  buildFlourish(push, rng, hand, runWidth, total);

  return { paths, nib: hand.nib, slant: hand.slant };
}

/**
 * Draw the signature. Never throws on an empty name — a blank signature line is
 * a better outcome than a letter that fails to generate.
 */
export function drawSignature(page: PDFPage, name: string, opts: SignatureOptions): void {
  if (!name || !name.trim()) return;

  const drawing = signaturePaths(name, opts);
  const ink = rgb(0.08, 0.1, 0.42);

  for (const { path, widthScale } of drawing.paths) {
    page.drawSvgPath(path, {
      x: opts.x,
      y: opts.y,
      borderColor: ink,
      borderWidth: drawing.nib * widthScale,
      rotate: degrees(drawing.slant),
    });
  }
}

/**
 * The large flourish — as big as the writing, and usually the first thing the
 * eye reads as a signature. Four archetypes, chosen per signer.
 *
 * Written throughout in fractions of `FLOURISH_DESCENT`, so a caller that
 * reserves that much room below the line cannot be overrun by any of them.
 */
function buildFlourish(
  stroke: (path: string, widthScale?: number) => void,
  rng: () => number,
  hand: Hand,
  runWidth: number,
  total: number
): void {
  const h = hand.height;
  const d = FLOURISH_DESCENT;
  const w = total;
  const start = runWidth;

  if (hand.flourish < 0.3) {
    // A ring thrown right round the writing. The closing arc overshoots its own
    // start — a ring drawn by hand never quite meets, and one that does reads as
    // a graphic rather than a stroke.
    const rx = w * 0.52;
    const ry = Math.min(h * 1.15, d * 0.9);
    const cx = w * 0.48;
    const cy = -h * 0.45;
    const k = 0.5523;
    const tilt = (rng() - 0.5) * 0.3;
    stroke(
      `M ${f(cx - rx)} ${f(cy + ry * tilt)} ` +
        `C ${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} ` +
        `C ${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} ` +
        `C ${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} ` +
        `C ${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx * 1.05)} ${f(cy + ry * k)} ${f(cx - rx * 1.08)} ${f(cy - ry * 0.15)}`
    );
  } else if (hand.flourish < 0.62) {
    // A serpentine: out of the last stroke, down and back across the full width
    // and round again. Two wide lobes, not three — three fit the same height
    // only by flattening into near-parallel lines.
    stroke(
      `M ${f(start)} ${f(-h * 0.2)} ` +
        `C ${f(w * 1.16)} ${f(-h * 0.1)} ${f(w * 1.12)} ${f(d * 0.46)} ${f(w * 0.42)} ${f(d * 0.44)} ` +
        `C ${f(-w * 0.2)} ${f(d * 0.42)} ${f(-w * 0.18)} ${f(d * 0.86)} ${f(w * 0.3)} ${f(d * 0.88)} ` +
        `C ${f(w * 0.72)} ${f(d * 0.9)} ${f(w * 0.74)} ${f(d * 1.0)} ${f(-w * 0.02)} ${f(d * 0.98)}`
    );
  } else if (hand.flourish < 0.85) {
    // A loop thrown out of the last stroke, falling below the line and
    // recovering. The controls run wide and cross; pulled tight they meet at a
    // point and the stroke reads as a tick.
    const span = Math.max(w - start, 12);
    stroke(
      `M ${f(start)} ${f(-h * 0.15)} ` +
        `C ${f(start + span * 0.7)} ${f(-h * 1.9)} ${f(w * 1.2)} ${f(-h * 0.9)} ${f(start + span * 0.3)} ${f(d * 0.4)} ` +
        `C ${f(start)} ${f(d * 0.92)} ${f(w * 0.82)} ${f(d * 0.88)} ${f(w * 1.02)} ${f(-h * 0.1)}`
    );
  } else {
    // A long rising hairline, and a second running back underneath.
    const lift = h * (0.5 + rng() * 0.5);
    const span = Math.max(w - start, 12);
    stroke(
      `M ${f(start)} ${f(-1)} C ${f(start + span * 0.35)} ${f(-lift)} ${f(start + span * 0.6)} ${f(-lift * 1.2)} ${f(start + span)} ${f(-lift * 0.8)}`
    );
    const dip = 2 + rng() * 2.5;
    stroke(
      `M ${f(w * 0.98)} ${f(d * 0.25)} C ${f(w * 0.6)} ${f(d * 0.25 + dip)} ${f(w * 0.3)} ${f(d * 0.25 - dip * 0.5)} ${f(w * 0.02)} ${f(d * 0.25 + dip * 0.4)}`
    );
  }

  // A stroke driven straight through the writing, overshooting both ends and
  // drawn thinner: one fast pass of the pen, not part of the drawing.
  if (hand.strike) {
    const through = -h * (0.35 + rng() * 0.25);
    stroke(
      `M ${f(-w * 0.05)} ${f(through + 2.5)} C ${f(w * 0.3)} ${f(through - 1)} ${f(w * 0.6)} ${f(through - 1.5)} ${f(w * 1.04)} ${f(through - 3.5)}`,
      0.85
    );
  }
}
