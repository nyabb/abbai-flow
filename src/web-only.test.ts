import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Abbai Flow is web-only (desktop, mobile browser and a Raspberry Pi Chromium
 * kiosk). These guards fail loudly if a native shell creeps back in — the
 * app's whole deployment story is one Docker image plus a browser.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

describe('web-only packaging', () => {
  it('declares no Capacitor packages', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const capacitor = Object.keys(all).filter((name) => name.includes('capacitor'));

    expect(capacitor).toEqual([]);
  });

  it('has no native build scripts', () => {
    const native = Object.keys(pkg.scripts ?? {}).filter((name) => name.startsWith('cap:'));

    expect(native).toEqual([]);
  });

  it('keeps the web, add-on and backend scripts intact', () => {
    for (const script of ['dev', 'build', 'test', 'test:server', 'test:all', 'lint', 'format']) {
      expect(pkg.scripts?.[script], script).toBeTruthy();
    }
  });

  it('ships no native project directories or Capacitor config', () => {
    for (const entry of ['android', 'ios', 'capacitor.config.ts']) {
      expect(existsSync(path.join(root, entry)), entry).toBe(false);
    }
  });
});
