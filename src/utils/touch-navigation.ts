import type { SidebarView } from '../components/Sidebar';

/** Mobile tab order followed by Settings, which is in the Omni Add menu. */
export const TOUCH_NAV_ORDER: readonly SidebarView[] = [
  'calendar',
  'meals',
  'grocery',
  'chores',
  'music',
  'weather',
  'timer',
  'settings',
];
