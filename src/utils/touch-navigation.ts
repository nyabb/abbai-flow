import type { SidebarView } from '../components/Sidebar';

/** Bottom navigation order followed by Settings below the Omni Add trigger. */
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
