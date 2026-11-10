#!/usr/bin/env node
/**
 * Beacon icon export script.
 *
 * Generates every raster icon size Beacon needs (favicon, PWA manifest icons)
 * from the single source SVG (`src/assets/beacon-app-icon.svg`)
 * plus a maskable variant (`src/assets/beacon-app-icon-maskable.svg`).
 *
 * This exists so the icon set can never drift out of sync again: change the
 * source SVG, re-run `node scripts/export-icons.mjs`, done. No hand-exporting
 * PNGs one size at a time.
 *
 * Usage: node scripts/export-icons.mjs
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const assetsDir = path.join(root, 'src', 'assets');

const SOURCE_SVG = path.join(assetsDir, 'beacon-app-icon.svg');
const MASKABLE_SVG = path.join(assetsDir, 'beacon-app-icon-maskable.svg');

// Standard (non-maskable) sizes exported from the main app-icon source.
const STANDARD_SIZES = [16, 32, 64, 192, 256, 512];

async function exportSize(svgPath, size, outPath) {
  const svgBuffer = readFileSync(svgPath);
  await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(outPath);
  console.log(`  wrote ${path.relative(root, outPath)} (${size}x${size})`);
}

async function main() {
  console.log('Exporting Beacon icon set from', path.relative(root, SOURCE_SVG));

  for (const size of STANDARD_SIZES) {
    const outPath = path.join(assetsDir, `beacon-app-icon-${size}.png`);
    await exportSize(SOURCE_SVG, size, outPath);
  }

  // Favicon-style alias sizes some consumers look for.
  await exportSize(SOURCE_SVG, 32, path.join(assetsDir, 'beacon-favicon-32.png'));
  await exportSize(SOURCE_SVG, 64, path.join(assetsDir, 'beacon-icon-64.png'));
  await exportSize(SOURCE_SVG, 256, path.join(assetsDir, 'beacon-icon-256.png'));
  await exportSize(SOURCE_SVG, 512, path.join(assetsDir, 'beacon-icon-512.png'));

  // Maskable variant (full-bleed, safe-zone padded) at 192px for PWA manifest.
  await exportSize(MASKABLE_SVG, 192, path.join(assetsDir, 'beacon-app-icon-192-maskable.png'));

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
