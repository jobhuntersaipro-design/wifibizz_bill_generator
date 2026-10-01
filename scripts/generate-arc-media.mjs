/**
 * Placeholder media for the Arc gallery (/dashboard/design).
 *
 * Arc's blocks reference demo portraits, photos and tool logos that are not in
 * its open-source repository. This writes neutral stand-ins to public/arc-media/:
 * initials for people, soft gradients for photos, and plain geometric marks for
 * logos — deliberately NOT imitations of any real brand's logo.
 *
 * Run: node --experimental-strip-types scripts/generate-arc-media.mjs (it imports media.ts)
 */
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { people, photos } from "../src/components/arc/lib/media.ts";

const OUT = "public/arc-media";
const HUES = [300, 250, 200, 160, 120, 60, 30, 340];

function hash(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function portrait(name) {
  const hue = HUES[hash(name) % HUES.length];
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
  <rect width="400" height="400" fill="hsl(${hue} 35% 86%)"/>
  <text x="200" y="200" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="150" font-weight="600" fill="hsl(${hue} 30% 32%)">${initials}</text>
</svg>`;
}

function landscape(id, width, height) {
  const a = HUES[hash(id) % HUES.length];
  const b = HUES[(hash(id) >> 3) % HUES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${a} 32% 78%)"/><stop offset="1" stop-color="hsl(${b} 30% 62%)"/>
  </linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${width * 0.72}" cy="${height * 0.34}" r="${Math.min(width, height) * 0.16}" fill="hsl(${a} 40% 92% / .55)"/>
</svg>`;
}

const SHAPES = [
  '<circle cx="12" cy="12" r="9"/>',
  '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/>',
  '<path d="M12 3 21 20H3z"/>',
  '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/>',
  '<path d="M4 4h7v7H4zM13 13h7v7h-7zM13 4h7v7h-7z"/>',
  '<path d="M12 3a9 9 0 1 0 0 18V3z"/><circle cx="16" cy="12" r="3"/>',
];

function mark(name, color) {
  const shape = SHAPES[hash(name.replace(/-color$/, "")) % SHAPES.length];
  const fill = color ? `hsl(${HUES[hash(name) % HUES.length]} 55% 50%)` : "#000";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="${fill}">${shape}</svg>\n`;
}

const LOGOS = ["figma", "framer", "github", "linear", "loom", "notion", "raycast", "slack", "stripe", "supabase", "vercel", "hubspot"];

await mkdir(`${OUT}/people`, { recursive: true });
await mkdir(`${OUT}/photos`, { recursive: true });
await mkdir(`${OUT}/logos`, { recursive: true });

for (const p of people) {
  await sharp(Buffer.from(portrait(p.name))).jpeg({ quality: 72 }).toFile(`${OUT}${p.src.replace("/arc-media", "")}`);
}
for (const p of photos) {
  // A quarter of the declared size: the gallery only needs the aspect ratio.
  const w = Math.round(p.width / 4), h = Math.round(p.height / 4);
  await sharp(Buffer.from(landscape(p.id, w, h))).jpeg({ quality: 70 }).toFile(`${OUT}${p.src.replace("/arc-media", "")}`);
}
for (const name of LOGOS) {
  await writeFile(`${OUT}/logos/${name}.svg`, mark(name, false));
  await writeFile(`${OUT}/logos/${name}-color.svg`, mark(name, true));
}
console.log(`wrote ${people.length} portraits, ${photos.length} photos, ${LOGOS.length * 2} marks to ${OUT}`);
