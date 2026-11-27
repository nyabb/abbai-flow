import { useState, useCallback, useEffect, useMemo } from 'react';
import { getConfig } from '../config';
import { loadDataSync, loadServerData, saveData } from '../api/abbai-flow-store';
import { setDebugCaptureEnabled } from '../api/debug-log';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AbbaiSettings {
  // General
  familyName: string;
  saveConfigInBrowser: boolean;
  defaultView: 'calendar' | 'grocery' | 'music';
  timeFormat: '12h' | '24h';
  weekStartsOn: 0 | 1; // 0 = Sunday, 1 = Monday
  locale: string;
  debugMode: boolean;

  // Appearance
  themeId: string;
  autoDarkMode: boolean;
  darkModeStart: string; // "HH:mm"
  darkModeEnd: string; // "HH:mm"
  fontScale: 'normal' | 'large' | 'extra-large';

  // Calendar
  defaultCalendar: string;
  permanentlyHiddenCalendars: string[];
  calendarColors: Record<string, string>;
  defaultEventDuration: 30 | 60 | 120;
  notificationMinutes: 5 | 10 | 15 | 30;

  // Integrations
  defaultGroceryList: string;
  groceryListIds: string[];
  /** Explicit iCloud Reminders list keys used by the Tasks view. */
  taskListIds?: string[];
  photoInterval: number;
  photoTransition: 'fade' | 'slide';

  // Display
  screenSaverEnabled: boolean;
  screenSaverMode: 'clock' | 'photos' | 'mixed';
  dimTimeout: number; // minutes
  screenSaverTimeout: number; // minutes
  alwaysOnDisplay: boolean;
  showSeconds: boolean;

  /** Cut animation and transition durations app-wide. */
  reducedMotion: boolean;

  // Chores
  choresResetTime: string; // "HH:mm"
  streakDays: number;
  currencySymbol: string;
  payoutSchedule: 'weekly' | 'monthly';
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'abbai-flow-settings';

function buildDefaults(): AbbaiSettings {
  const config = getConfig();

  return {
    familyName: config.family_name,
    saveConfigInBrowser: config.save_config_in_browser,
    defaultView: 'calendar',
    timeFormat: '12h',
    weekStartsOn: 0,
    locale: 'en-US',
    debugMode: false,

    themeId: config.theme,
    autoDarkMode: config.auto_dark_mode,
    darkModeStart: '19:00',
    darkModeEnd: '06:00',
    fontScale: 'normal',

    defaultCalendar: '',
    permanentlyHiddenCalendars: [],
    calendarColors: {},
    defaultEventDuration: 60,
    notificationMinutes: 10,

    defaultGroceryList: '',
    groceryListIds: [],
    photoInterval: config.photo_interval,
    photoTransition: 'fade',


    screenSaverEnabled: true,
    screenSaverMode: 'clock',
    dimTimeout: 5,
    screenSaverTimeout: config.screen_saver_timeout,
    alwaysOnDisplay: false,
    showSeconds: false,

    choresResetTime: '00:00',
    streakDays: 7,
    currencySymbol: '$',
    payoutSchedule: 'weekly',

    reducedMotion: false,
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function loadSettingsAsync(): Promise<AbbaiSettings> {
  const defaults = buildDefaults();
  const configAllowsBrowserStorage = getConfig().save_config_in_browser;
  const serverStored = await loadServerData<PersistedSettings>(STORAGE_KEY);
  const stored =
    serverStored ??
    (configAllowsBrowserStorage ? loadDataSync<PersistedSettings>(STORAGE_KEY, {}) : {});
  return {
    ...normalizeSettings(defaults, stored),
    // Runtime configuration is authoritative: it can disable browser
    // storage, while the user preference can opt out when config allows it.
    saveConfigInBrowser: configAllowsBrowserStorage && (stored.saveConfigInBrowser ?? true),
  };
}

function persistSettings(settings: AbbaiSettings): void {
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

type PersistedSettings = Omit<Partial<AbbaiSettings>, 'defaultView'> & {
  defaultView?: string;
  dashboardLayout?: unknown;
  advancedDashboard?: unknown;
};

function normalizeSettings(defaults: AbbaiSettings, stored: PersistedSettings = {}): AbbaiSettings {
  const saved = { ...stored } as Record<string, unknown>;
  delete saved.dashboardLayout;
  // Ignore the removed preference when loading older saved settings.
  delete saved.sidebarPosition;
  delete saved.advancedDashboard;
  delete saved.displayWakeLock;
  delete saved.displayFullscreen;
  delete saved.displayIdleMinutes;
  delete saved.displayPanels;
  delete saved.anylistEnabled;
  delete saved.kioskMode;
  delete saved.choresEnabled;
  delete saved.choresProvider;
  delete saved.weatherEntity;

  const storedView = saved.defaultView;
  const defaultView =
    storedView === 'dashboard'
      ? 'calendar'
      : storedView === 'tasks'
        ? 'grocery'
        : storedView === 'calendar' ||
            storedView === 'grocery' ||
            storedView === 'music'
          ? storedView
          : defaults.defaultView;

  return {
    ...defaults,
    ...saved,
    defaultView,
  } as AbbaiSettings;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSettings() {
  const [settings, setSettingsState] = useState<AbbaiSettings>(buildDefaults);
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
    setDebugCaptureEnabled(serverSettings.debugMode);
    setSettingsState(serverSettings);
    setLoaded(true);
  }, []);

  // Fetch from server on mount, update if server has newer data
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetch when the app becomes visible to refresh stale settings.
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
  const updateSettings = useCallback((patch: Partial<AbbaiSettings>) => {
    if (patch.debugMode !== undefined) setDebugCaptureEnabled(patch.debugMode);
    setSettingsState((prev) => ({ ...prev, ...patch }));
  }, []);

  /** Reset all settings to defaults (merged with config.yaml values). */
  const resetSettings = useCallback(() => {
    const defaults = buildDefaults();
    setDebugCaptureEnabled(defaults.debugMode);
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
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const defaults = buildDefaults();
      const imported = normalizeSettings(defaults, parsed as PersistedSettings);
      setDebugCaptureEnabled(imported.debugMode);
      setSettingsState(imported);
    } catch {
      // invalid JSON — do nothing
    }
  }, []);

  /** Clear all Abbai Flow data from localStorage. */
  const clearLocalStorage = useCallback(() => {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('abbai-flow-') || key?.startsWith('abbai_flow_')) {
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
