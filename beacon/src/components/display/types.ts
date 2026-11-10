/**
 * Display Mode types and defaults.
 *
 * Kept out of `DisplayView.tsx` so that file only exports a component — a module
 * mixing components and constants breaks React Fast Refresh, which matters for a
 * screen that is edited while it is running on a kiosk.
 */

/** What the display should say about connectivity. */
export type DisplayConnection = 'online' | 'beacon-down' | 'ha-down' | 'offline';

/** Which panels the display shows. Stored in settings so each device can choose. */
export interface DisplayPanelFlags {
  agenda: boolean;
  chores: boolean;
  family: boolean;
  weather: boolean;
}

export const DEFAULT_DISPLAY_PANELS: DisplayPanelFlags = {
  agenda: true,
  chores: true,
  family: true,
  weather: true,
};
