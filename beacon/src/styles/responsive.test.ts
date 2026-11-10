import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * The responsive layer is plain CSS, so what can be pinned is that it stays
 * *connected* to reality: it must keep the documented breakpoint ladder, and
 * every class it targets must exist in another stylesheet. That second check
 * catches the real failure mode — a rule that silently does nothing because the
 * class was renamed (`.dash-grid` was exactly such a phantom).
 */
const stylesDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(stylesDir, '..');

const responsive = readFileSync(path.join(stylesDir, 'responsive.css'), 'utf8');

const otherSheets = readdirSync(stylesDir)
  .filter((file) => file.endsWith('.css') && file !== 'responsive.css')
  .map((file) => readFileSync(path.join(stylesDir, file), 'utf8'))
  .join('\n');

/** Every .tsx in the app, so state classes applied from JS count as "used". */
function componentSources(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return componentSources(full);
      if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) return [];
      return [readFileSync(full, 'utf8')];
    })
    .join('\n');
}

const sources = componentSources(srcDir);

/** Class selectors used in the responsive layer's rule heads. */
function responsiveClasses(): string[] {
  const heads = responsive.match(/[^{}]+\{/g) ?? [];
  const found = new Set<string>();
  for (const head of heads) {
    for (const match of head.matchAll(/\.([a-zA-Z][\w-]*)/g)) found.add(match[1]);
  }
  return [...found];
}

describe('responsive layer', () => {
  it('keys touch sizing off pointer capability, not width', () => {
    expect(responsive).toContain('@media (pointer: coarse)');
  });

  it('documents the breakpoint ladder the app already uses', () => {
    for (const width of ['480px', '640px', '768px', '1024px', '1600px']) {
      expect(responsive, width).toContain(width);
    }
  });

  it('scales up for wall displays', () => {
    expect(responsive).toMatch(/@media \(min-width: 1600px\)/);
  });

  it('honours reduced motion', () => {
    // The layer must not add an animation that ignores the preference.
    const animations = responsive.match(/animation:/g) ?? [];
    expect(animations).toHaveLength(0);
  });

  it('only targets classes that exist somewhere', () => {
    // A class either has styling elsewhere or is applied from JS (state hooks
    // like `beacon--reduce-motion` live only in this layer).
    const missing = responsiveClasses().filter(
      (name) => !otherSheets.includes(`.${name}`) && !sources.includes(name),
    );

    expect(missing).toEqual([]);
  });
});

/**
 * Touch ergonomics: a kiosk tap must land first time, and the screen must not
 * start zooming or scroll-chaining when a finger drags.
 */
describe('touch interaction layer', () => {
  it('removes the double-tap-zoom delay on controls', () => {
    expect(responsive).toContain('touch-action: manipulation');
  });

  it('stops dialogs from scroll-chaining into the page behind them', () => {
    expect(responsive).toContain('overscroll-behavior: contain');
  });

  it('gives footer actions in dialogs a finger-sized target', () => {
    expect(responsive).toMatch(/\.modal-footer-right button,\s*\.planner-sheet-footer button \{/);
    expect(responsive).toMatch(/min-height: 48px/);
  });

  it('keeps a pressed state for devices without hover', () => {
    expect(responsive).toContain(':active');
    expect(responsive).toMatch(/transform: scale/);
  });

  it('sizes form fields for touch and avoids iOS focus zoom', () => {
    expect(responsive).toMatch(/\.settings-time-input \{[^}]*font-size: 16px/s);
  });

  it('handles a phone in landscape', () => {
    expect(responsive).toMatch(/@media \(orientation: landscape\) and \(max-height: 480px\)/);
  });
});
