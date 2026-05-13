// Generate public/icon.ico (Windows) and public/icon.png from an inline SVG.
// Run with: npm run build:icon
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------
// Logo SVG — Orbit Downloader
//   Composition:
//     • Rounded-square plate in a vertical Claude-coral gradient
//     • Subtle top-edge highlight for an Apple-style depth
//     • A tilted thin elliptical orbit-ring drawn BEHIND the arrow —
//       enough to tie back to the "Orbit" brand without distracting
//     • A bold, balanced download arrow centred in the plate
//     • A short "tray" line under the arrow — universal download metaphor
//   Reads cleanly down to 16×16.
// ---------------------------------------------------------------
const SVG = `
<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E8865F"/>
      <stop offset="1" stop-color="#C9633E"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.5" cy="0" r="0.9">
      <stop offset="0"   stop-color="#FFFFFF" stop-opacity="0.20"/>
      <stop offset="0.6" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Plate -->
  <rect width="256" height="256" rx="58" ry="58" fill="url(#bg)"/>
  <rect width="256" height="256" rx="58" ry="58" fill="url(#sheen)"/>

  <!-- Orbit ring sitting behind the arrow, tilted like Saturn's belt -->
  <g transform="translate(128 128) rotate(-22)">
    <ellipse cx="0" cy="0" rx="82" ry="22"
      fill="none" stroke="#FFFFFF" stroke-opacity="0.30" stroke-width="5"/>
  </g>

  <!-- Download arrow: stem + chevron head -->
  <g fill="none" stroke="#FFFFFF" stroke-width="24"
     stroke-linecap="round" stroke-linejoin="round">
    <line x1="128" y1="62" x2="128" y2="170"/>
    <polyline points="76 122 128 174 180 122"/>
  </g>

  <!-- Tray: the universal "drop here" indicator -->
  <line x1="74" y1="206" x2="182" y2="206"
        stroke="#FFFFFF" stroke-width="20" stroke-linecap="round"/>
</svg>
`.trim();

// Sizes Windows wants in a .ico (plus a big one for high-DPI scaling)
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  console.log('Rendering icon PNGs from inline SVG…');
  const pngs = await Promise.all(
    SIZES.map(async (size) => {
      const png = await sharp(Buffer.from(SVG))
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toBuffer();
      console.log(`  - ${size}x${size}  (${png.length.toLocaleString()} bytes)`);
      return png;
    })
  );

  // Also write a 512×512 PNG for non-Windows / docs use
  const png512 = await sharp(Buffer.from(SVG)).resize(512, 512).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png512);
  console.log('Wrote public/icon.png (512×512)');

  // Bundle into .ico
  const ico = await pngToIco(pngs);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);
  console.log(`Wrote public/icon.ico (${ico.length.toLocaleString()} bytes, ${SIZES.length} entries)`);

  // Drop the raw SVG too — useful for in-app HTML / docs / favicon
  fs.writeFileSync(path.join(OUT_DIR, 'icon.svg'), SVG);
  console.log('Wrote public/icon.svg');

  // Replace existing favicon.svg so the dev browser tab matches too
  fs.writeFileSync(path.join(OUT_DIR, 'favicon.svg'), SVG);
  console.log('Wrote public/favicon.svg');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
