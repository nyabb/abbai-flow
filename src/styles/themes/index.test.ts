import { describe, it, expect } from 'vitest';
import { themes } from './index';

/**
 * Theme accent colors are used throughout the app's headers and controls. Keep
 * every theme explicit so a missing value cannot silently fall back to blue.
 */
describe('themes — accent color contract', () => {
  it('every theme defines a non-empty colors.accent', () => {
    for (const theme of themes) {
      expect(theme.colors.accent, `theme "${theme.id}" is missing an accent color`).toBeTruthy();
      expect(theme.colors.accent).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });

  it('has at least the 8 themes documented in docs/design-tokens.md', () => {
    expect(themes.length).toBeGreaterThanOrEqual(8);
  });

  it('every theme id is unique', () => {
    const ids = themes.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every theme defines exactly 6 eventColors (one per family-member slot)', () => {
    for (const theme of themes) {
      expect(theme.eventColors, `theme "${theme.id}"`).toHaveLength(6);
    }
  });

  it('every theme sets all three font roles (display/body/mono)', () => {
    for (const theme of themes) {
      expect(theme.fonts.display, `theme "${theme.id}" display font`).toBeTruthy();
      expect(theme.fonts.body, `theme "${theme.id}" body font`).toBeTruthy();
      expect(theme.fonts.mono, `theme "${theme.id}" mono font`).toBeTruthy();
    }
  });
});
