import type { SidebarView } from '../components/Sidebar';

/** Mobile tab order followed by the pages listed in its More menu. */
export const TOUCH_NAV_ORDER: readonly SidebarView[] = [
  'dashboard',
  'calendar',
  'chores',
  'grocery',
  'music',
  'photos',
  'timer',
  'weather',
  'display',
  'settings',
];
