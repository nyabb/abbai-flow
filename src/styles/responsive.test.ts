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

const responsive = readFileSync(path.join(stylesDir, 'responsive.css'), 'utf8');

const otherSheets = readdirSync(stylesDir)
  .filter((file) => file.endsWith('.css') && file !== 'responsive.css')
  .map((file) => readFileSync(path.join(stylesDir, file), 'utf8'))
  .join('\n');

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

  it('only targets classes that exist elsewhere', () => {
    const missing = responsiveClasses().filter((name) => !otherSheets.includes(`.${name}`));

    expect(missing).toEqual([]);
  });
});
