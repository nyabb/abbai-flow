/**
 * Display Mode route detection.
 *
 * The app has no router — views are a single `activeView` state — so the only
 * URL it needs to understand is the one a wall-mounted device is pointed at:
 * `/display`.
 *
 * Deliberately path-only. `?display=<memberId>` already means "lock this device
 * to one family member" (kid display / focus mode), so the display mode must not
 * claim that query param.
 *
 * The trailing-slash and case tolerance is for hand-typed kiosk URLs; the Home
 * Assistant ingress base path is preserved because only the suffix is matched.
 */
export function isDisplayUrl(location: Pick<Location, 'pathname'>): boolean {
  return /\/display\/?$/i.test(location.pathname);
}
