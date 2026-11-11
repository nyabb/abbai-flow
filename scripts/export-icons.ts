#!/usr/bin/env node
/**
 * Abbai Flow icon export script.
 *
 * Generates every raster icon Abbai Flow needs (favicon, apple-touch icon, PWA
 * manifest icons, Open Graph card) from the single source mark
 * `src/assets/abbai-flow-icon.svg` plus its two companions:
 *
 * - `abbai-flow-icon-maskable.svg` — full-bleed variant for launcher masks
 * - `abbai-flow-og.svg`           — 1200x630 social card
 *
 * Output goes to `public/` on purpose: those URLs are stable (`/icon-192.png`),
 * so `manifest.json` and `index.html` keep working in the production build.
 * Anything under `src/assets/` is hashed by Vite, which silently 404'd every
 * PWA icon before.
 *
 * This exists so the icon set can never drift out of sync again: change the
 * source SVG, re-run `node --experimental-strip-types scripts/export-icons.ts`,
 * done. No hand-exporting PNGs one size at a time, and no second copy of the
 * artwork anywhere else in the repo.
 *
 * Usage: node --experimental-strip-types scripts/export-icons.ts
 */
import sharp from 'sharp';
import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const assetsDir = path.join(root, 'src', 'assets');
const publicDir = path.join(root, 'public');

const SOURCE_SVG = path.join(assetsDir, 'abbai-flow-icon.svg');
const MASKABLE_SVG = path.join(assetsDir, 'abbai-flow-icon-maskable.svg');
const OG_SVG = path.join(assetsDir, 'abbai-flow-og.svg');

/** Square sizes exported from the mark (16 covers the smallest favicon). */
const STANDARD_SIZES: number[] = [16, 32, 64, 180, 192, 256, 512];

/** Maskable sizes: how launchers render Android/PWA icons with their own mask. */
const MASKABLE_SIZES: number[] = [192, 512];

async function exportSquare(svgPath: string, size: number, outPath: string): Promise<void> {
  const svgBuffer = readFileSync(svgPath);
  await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(outPath);
  console.log(`  wrote ${path.relative(root, outPath)} (${size}x${size})`);
}

async function exportOg(): Promise<void> {
  const outPath = path.join(publicDir, 'og.png');
  await sharp(readFileSync(OG_SVG), { density: 192 }).resize(1200, 630).png().toFile(outPath);
  console.log(`  wrote ${path.relative(root, outPath)} (1200x630)`);
}

async function main(): Promise<void> {
  console.log('Exporting the Abbai Flow icon set from', path.relative(root, SOURCE_SVG));

  for (const size of STANDARD_SIZES) {
    const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
    await exportSquare(SOURCE_SVG, size, path.join(publicDir, name));
  }

  for (const size of MASKABLE_SIZES) {
    await exportSquare(MASKABLE_SVG, size, path.join(publicDir, `icon-${size}-maskable.png`));
  }

  await exportOg();

  // The browser favicon is the vector mark itself: sharp at every size.
  copyFileSync(SOURCE_SVG, path.join(publicDir, 'favicon.svg'));
  console.log('  copied public/favicon.svg');

  console.log('Done.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
