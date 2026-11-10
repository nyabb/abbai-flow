import { useState, useCallback, useEffect, useMemo } from 'react';
import { getConfig } from '../config';
import { loadDataSync, loadServerData, saveData } from '../api/beacon-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BeaconSettings {
  // General
  familyName: string;
  saveConfigInBrowser: boolean;
  defaultView: 'dashboard' | 'calendar' | 'grocery' | 'music' | 'photos';
  timeFormat: '12h' | '24h';
  weekStartsOn: 0 | 1; // 0 = Sunday, 1 = Monday
  locale: string;

  // Appearance
  themeId: string;
  autoDarkMode: boolean;
  darkModeStart: string; // "HH:mm"
  darkModeEnd: string; // "HH:mm"
  fontScale: 'normal' | 'large' | 'extra-large';
  sidebarPosition: 'left' | 'right' | 'bottom';

  // Calendar
  defaultCalendar: string;
  permanentlyHiddenCalendars: string[];
  calendarColors: Record<string, string>;
  defaultEventDuration: 30 | 60 | 120;
  notificationMinutes: 5 | 10 | 15 | 30;

  // Integrations
  weatherEntity: string;
  grocyEnabled: boolean;
  anylistEnabled: boolean;
  defaultGroceryList: string;
  groceryListIds: string[];
  shoppingEntity: string;
  musicDefaultPlayer: string;
  photoDirectory: string;
  photoInterval: number;
  photoTransition: 'fade' | 'slide';

  // Dashboard
  dashboardLayout: 'default' | 'classic' | 'compact';
  advancedDashboard: boolean;

  // Display
  screenSaverEnabled: boolean;
  dimTimeout: number; // minutes
  screenSaverTimeout: number; // minutes
  alwaysOnDisplay: boolean;
  showSeconds: boolean;
  kioskMode: boolean;

  // Display Mode (/display): the wall-mounted touchscreen
  /** Keep the screen awake with the Screen Wake Lock API while on /display. */
  displayWakeLock: boolean;
  /** Go fullscreen when the display view opens. */
  displayFullscreen: boolean;
  /** Return to the dashboard after this many idle minutes; 0 = never. */
  displayIdleMinutes: number;
  /** Which panels the display view shows. */
  displayPanels: { agenda: boolean; chores: boolean; family: boolean; weather: boolean };
  /** Cut animation and transition durations app-wide. */
  reducedMotion: boolean;

  // Chores
  choresEnabled: boolean;
  choresResetTime: string; // "HH:mm"
  streakDays: number;
  currencySymbol: string;
  payoutSchedule: 'weekly' | 'monthly';
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'beacon-settings';

function buildDefaults(): BeaconSettings {
  const config = getConfig();

  return {
    familyName: config.family_name,
    saveConfigInBrowser: config.save_config_in_browser,
    defaultView: 'dashboard',
    timeFormat: '12h',
    weekStartsOn: 0,
    locale: 'en-US',

    themeId: config.theme,
    autoDarkMode: config.auto_dark_mode,
    darkModeStart: '19:00',
    darkModeEnd: '06:00',
    fontScale: 'normal',
    sidebarPosition: 'left',

    defaultCalendar: '',
    permanentlyHiddenCalendars: [],
    calendarColors: {},
    defaultEventDuration: 60,
    notificationMinutes: 10,

    weatherEntity: config.weather_entity,
    grocyEnabled: false,
    anylistEnabled: false,
    defaultGroceryList: '',
    groceryListIds: [],
    shoppingEntity: '',
    musicDefaultPlayer: '',
    photoDirectory: config.photo_directory,
    photoInterval: config.photo_interval,
    photoTransition: 'fade',

    dashboardLayout: 'default',
    advancedDashboard: false,

    screenSaverEnabled: true,
    dimTimeout: 5,
    screenSaverTimeout: config.screen_saver_timeout,
    alwaysOnDisplay: false,
    showSeconds: false,
    kioskMode: false,

    choresEnabled: true,
    choresResetTime: '00:00',
    streakDays: 7,
    currencySymbol: '$',
    payoutSchedule: 'weekly',

    // Display Mode defaults: a wall screen wants the screen kept awake, but
    // fullscreen and an idle timeout are opt-in — they are intrusive on a
    // device someone is actively using.
    displayWakeLock: true,
    displayFullscreen: false,
    displayIdleMinutes: 15,
    displayPanels: { agenda: true, chores: true, family: true, weather: true },
    reducedMotion: false,
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function loadSettingsAsync(): Promise<BeaconSettings> {
  const defaults = buildDefaults();
  const configAllowsBrowserStorage = getConfig().save_config_in_browser;
  const serverStored = await loadServerData<Partial<BeaconSettings>>(STORAGE_KEY);
  const stored =
    serverStored ??
    (configAllowsBrowserStorage ? loadDataSync<Partial<BeaconSettings>>(STORAGE_KEY, {}) : {});
  return {
    ...defaults,
    ...stored,
    // The add-on configuration is authoritative: it can disable browser
    // storage, while the user preference can opt out when config allows it.
    saveConfigInBrowser: configAllowsBrowserStorage && (stored.saveConfigInBrowser ?? true),
  };
}

function persistSettings(settings: BeaconSettings): void {
  const browserStorage = getConfig().save_config_in_browser && settings.saveConfigInBrowser;
  if (!browserStorage) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  saveData(STORAGE_KEY, settings, { browserStorage });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSettings() {
  const [settings, setSettingsState] = useState<BeaconSettings>(buildDefaults);
  const [loaded, setLoaded] = useState(false);

  /*
   * The Font Size setting is a document-level concern: it scales the root font
   * size, and everything sized in rem follows from there. Keeping it here rather
   * than in a component means it applies once the settings load, on every page,
   * including ones that never render the Appearance section.
   */
  useEffect(() => {
    document.documentElement.dataset.fontScale = settings.fontScale;
  }, [settings.fontScale]);

  /** Re-fetch settings from server. */
  const refresh = useCallback(async () => {
    const serverSettings = await loadSettingsAsync();
    setSettingsState(serverSettings);
    setLoaded(true);
  }, []);

  // Fetch from server on mount, update if server has newer data
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetch when the app becomes visible (mirror ha-entity-store pattern)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  // Persist whenever settings change
  useEffect(() => {
    if (loaded) persistSettings(settings);
  }, [settings, loaded]);

  /** Update one or more settings fields. Changes apply immediately. */
  const updateSettings = useCallback((patch: Partial<BeaconSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...patch }));
  }, []);

  /** Reset all settings to defaults (merged with config.yaml values). */
  const resetSettings = useCallback(() => {
    const defaults = buildDefaults();
    setSettingsState(defaults);
    persistSettings(defaults);
  }, []);

  /** Export current settings as a JSON string. */
  const exportSettings = useCallback((): string => {
    return JSON.stringify(settings, null, 2);
  }, [settings]);

  /** Import settings from a JSON string. Invalid JSON is silently ignored. */
  const importSettings = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json);
      const defaults = buildDefaults();
      setSettingsState({ ...defaults, ...parsed });
    } catch {
      // invalid JSON — do nothing
    }
  }, []);

  /** Clear all Beacon data from localStorage. */
  const clearLocalStorage = useCallback(() => {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('beacon')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }
  }, []);

  const defaults = useMemo(() => buildDefaults(), []);

  return {
    settings,
    defaults,
    updateSettings,
    resetSettings,
    exportSettings,
    importSettings,
    clearLocalStorage,
    refresh,
  };
}
