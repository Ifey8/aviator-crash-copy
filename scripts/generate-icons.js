/**
 * Generate PNG icon assets from public/icon.svg.
 * Run:  node scripts/generate-icons.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "public", "icon.svg");
const PUBLIC = path.join(ROOT, "public");

const targets = [
  { size: 16,  name: "favicon-16.png" },
  { size: 32,  name: "favicon-32.png" },
  { size: 64,  name: "favicon-64.png" },
  { size: 180, name: "apple-touch-icon.png" }, // iOS home screen
  { size: 192, name: "logo192.png" },          // PWA manifest
  { size: 512, name: "logo512.png" },          // PWA manifest / splash
];

(async () => {
  const svg = fs.readFileSync(SRC);
  for (const { size, name } of targets) {
    const out = path.join(PUBLIC, name);
    await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
    console.log(`✓ ${name} (${size}×${size})`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
