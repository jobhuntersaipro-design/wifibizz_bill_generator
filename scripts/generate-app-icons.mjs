/**
 * Rasterises the BizzFlow mark (the sidebar's purple tile + wifi glyph) into the
 * PNGs iOS and Android need for "Add to Home Screen".
 *
 * Source of truth is the inline SVG in src/components/dashboard/sidebar.tsx —
 * keep WIFI_PATHS in step with it.
 *
 *   node scripts/generate-app-icons.mjs
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const BRAND = "#635BFF";

// Lucide "wifi", 24x24 viewBox — verbatim from sidebar.tsx's WifiIcon.
const WIFI_PATHS = [
  "M12 20h.01",
  "M2 8.82a15 15 0 0 1 20 0",
  "M5 12.859a10 10 0 0 1 14 0",
  "M8.5 16.429a5 5 0 0 1 7 0",
];

/**
 * @param size    output edge length in px
 * @param glyph   glyph width as a fraction of the tile
 * @param radius  corner radius as a fraction of the tile (0 = square)
 */
function markSvg({ size, glyph, radius }) {
  const g = size * glyph;
  const offset = (size - g) / 2;
  const scale = g / 24;
  // Keep the stroke visually identical to the 2px-at-24 original.
  const stroke = 2;
  const r = size * radius;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BRAND}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="#FFFFFF"
     stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
${WIFI_PATHS.map((d) => `    <path d="${d}"/>`).join("\n")}
  </g>
</svg>`;
}

const OUTPUTS = [
  // iOS home screen. Square, opaque — iOS rounds it itself and renders
  // transparency as black.
  { path: "src/app/apple-icon.png", size: 180, glyph: 0.56, radius: 0 },
  // Browser tab / general purpose.
  { path: "src/app/icon.png", size: 512, glyph: 0.56, radius: 0.22 },
  // Android manifest, purpose "any".
  { path: "public/icon-192.png", size: 192, glyph: 0.56, radius: 0.22 },
  { path: "public/icon-512.png", size: 512, glyph: 0.56, radius: 0.22 },
  // Android manifest, purpose "maskable". Full-bleed with the glyph pulled
  // inside the 80% safe zone, because the launcher crops to its own shape.
  { path: "public/icon-maskable-512.png", size: 512, glyph: 0.42, radius: 0 },
];

await mkdir("public", { recursive: true });

for (const { path, size, glyph, radius } of OUTPUTS) {
  const svg = markSvg({ size, glyph, radius });
  await sharp(Buffer.from(svg)).png().toFile(path);
  console.log(`${path}  ${size}x${size}`);
}
