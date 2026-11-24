import { useState, useEffect, useCallback, useMemo } from 'react';
import { themes, getTheme, type Theme } from '../styles/themes';

export type ThemeMode = 'auto' | string; // 'auto' or a theme id

const THEME_STORAGE_KEY = 'abbai-flow-theme';
const AUTO_DARK_THEME_KEY = 'abbai-flow-auto-dark-theme';
const DEFAULT_DARK_MODE_START = '19:00';
const DEFAULT_DARK_MODE_END = '06:00';

export interface ThemePreferences {
  themeId: string;
  autoDarkMode: boolean;
  darkModeStart: string;
  darkModeEnd: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTime(value: string, fallback: number): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : fallback;
}

function isDarkModeTime(start: string, end: string, now = new Date()): boolean {
  const startMinutes = parseTime(start, 19 * 60);
  const endMinutes = parseTime(end, 6 * 60);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Equal start and end times mean there is no dark-mode window.
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function resolveTheme(
  preferences: ThemePreferences,
  autoDarkId: string,
  now?: Date,
): Theme {
  const automatic = preferences.autoDarkMode || preferences.themeId === 'auto';
  if (!automatic) return getTheme(preferences.themeId);

  if (isDarkModeTime(preferences.darkModeStart, preferences.darkModeEnd, now)) {
    return getTheme(autoDarkId);
  }
  return getTheme(preferences.themeId === 'auto' ? 'skylight' : preferences.themeId);
}

/** Apply a Theme's tokens as CSS custom properties on :root */
function applyThemeToDOM(theme: Theme): void {
  const root = document.documentElement;
  const { colors, eventColors, fonts } = theme;

  root.style.setProperty('--bg-primary', colors.background);
  root.style.setProperty('--bg-surface', colors.surface);
  root.style.setProperty('--bg-header', colors.headerBg);
  root.style.setProperty('--bg-sidebar', colors.headerBg);
  root.style.setProperty('--bg-today', colors.todayHighlight);
  root.style.setProperty('--border', colors.gridLines);
  root.style.setProperty('--border-subtle', colors.gridLines);
  root.style.setProperty('--text-primary', colors.text);
  root.style.setProperty('--text-secondary', colors.textSecondary);
  root.style.setProperty('--grid-lines', colors.gridLines);
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--shadow', colors.shadow);

  eventColors.forEach((color, i) => {
    root.style.setProperty(`--event-${i + 1}`, color);
  });

  root.style.setProperty('--font-display', fonts.display);
  root.style.setProperty('--font-body', fonts.body);
  root.style.setProperty('--font-mono', fonts.mono);

  // Also set data-theme so other CSS can hook into light/dark if needed.
  // Determine light vs dark by checking luminance of background hex.
  const isDark = isColorDark(colors.background);
  root.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

/** Rough luminance check for a hex color */
function isColorDark(hex: string): boolean {
  const cleaned = hex.replace('#', '');
  if (cleaned.length < 6) return false;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  // Perceived brightness formula
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function loadStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable
  }
}

// ---------------------------------------------------------------------------
// Eager theme application (called before React renders to prevent flash)
// ---------------------------------------------------------------------------

export function applyStoredTheme(): void {
  const storedId = loadStored(THEME_STORAGE_KEY, 'skylight');
  // The settings object is authoritative when browser storage is enabled.
  let preferences: ThemePreferences = {
    themeId: storedId,
    autoDarkMode: false,
    darkModeStart: DEFAULT_DARK_MODE_START,
    darkModeEnd: DEFAULT_DARK_MODE_END,
  };
  try {
    const settingsRaw = localStorage.getItem('abbai-flow-settings');
    if (settingsRaw) {
      const parsed = JSON.parse(settingsRaw);
      preferences = {
        ...preferences,
        themeId: parsed.themeId ?? preferences.themeId,
        autoDarkMode: parsed.autoDarkMode ?? preferences.autoDarkMode,
        darkModeStart: parsed.darkModeStart ?? preferences.darkModeStart,
        darkModeEnd: parsed.darkModeEnd ?? preferences.darkModeEnd,
      };
    }
  } catch { /* ignore */ }

  const autoDarkId = loadStored(AUTO_DARK_THEME_KEY, 'midnight');
  applyThemeToDOM(resolveTheme(preferences, autoDarkId));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTheme(preferences?: ThemePreferences) {
  const [themeId, setThemeIdState] = useState<string>(() =>
    loadStored(THEME_STORAGE_KEY, 'skylight'),
  );

  // The dark theme used by auto mode when it switches to night
  const [autoDarkId] = useState<string>(() =>
    loadStored(AUTO_DARK_THEME_KEY, 'midnight'),
  );

  /** Resolve the active theme object based on current mode and time */
  const selectedThemeId = preferences?.themeId ?? themeId;
  const autoDarkMode = preferences?.autoDarkMode ?? false;
  const darkModeStart = preferences?.darkModeStart ?? DEFAULT_DARK_MODE_START;
  const darkModeEnd = preferences?.darkModeEnd ?? DEFAULT_DARK_MODE_END;
  const resolvedTheme = useMemo<Theme>(
    () =>
      resolveTheme(
        { themeId: selectedThemeId, autoDarkMode, darkModeStart, darkModeEnd },
        autoDarkId,
      ),
    [selectedThemeId, autoDarkMode, darkModeStart, darkModeEnd, autoDarkId],
  );

  const setTheme = useCallback((id: string) => {
    setThemeIdState(id);
    persist(THEME_STORAGE_KEY, id);
  }, []);

  // Apply CSS custom properties whenever the resolved theme changes
  useEffect(() => {
    applyThemeToDOM(resolvedTheme);
  }, [resolvedTheme]);

  // For auto mode, re-evaluate every 60 seconds so day/night flips on time
  useEffect(() => {
    if (!autoDarkMode && selectedThemeId !== 'auto') return;

    const interval = setInterval(() => {
      const next = resolveTheme(
        { themeId: selectedThemeId, autoDarkMode, darkModeStart, darkModeEnd },
        autoDarkId,
      );
      applyThemeToDOM(next);
    }, 60_000);

    return () => clearInterval(interval);
  }, [selectedThemeId, autoDarkMode, darkModeStart, darkModeEnd, autoDarkId]);

  const availableThemes = useMemo(
    () => themes.map(({ id, name }) => ({ id, name })),
    [],
  );

  return {
    /** The currently resolved full Theme object */
    theme: resolvedTheme,
    /** The stored theme id (may be 'auto') */
    themeId,
    /** Set the theme by id. Pass 'auto' for time-based switching. */
    setTheme,
    /** List of { id, name } for all registered themes */
    availableThemes,
  };
}
