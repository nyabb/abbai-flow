import { useCallback, useRef, type TouchEvent } from 'react';
import type { SidebarView } from '../components/Sidebar';

const MIN_SWIPE_DISTANCE = 64;
const IGNORE_SWIPE_SELECTOR =
  'button, a, input, textarea, select, dialog, [role="dialog"], [aria-modal="true"], [role="slider"], [contenteditable="true"], [draggable="true"], [data-page-swipe-ignore]';

interface TouchStart {
  x: number;
  y: number;
}

interface UseTouchPageSwipeOptions {
  activeView: SidebarView;
  navigationOrder: readonly SidebarView[];
  onNavigate: (view: SidebarView) => void;
  enabled?: boolean;
}

function shouldIgnoreSwipe(target: EventTarget | null, container: HTMLElement): boolean {
  if (!(target instanceof Element) || target.closest(IGNORE_SWIPE_SELECTOR)) return true;

  let element: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement;
  while (element) {
    const overflowX = window.getComputedStyle(element).overflowX;
    if (
      (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
      element.scrollWidth > element.clientWidth + 1
    ) {
      return true;
    }
    if (element === container) break;
    element = element.parentElement;
  }
  return false;
}

/** Navigates in menu order on a deliberate horizontal touch swipe. */
export function useTouchPageSwipe({
  activeView,
  navigationOrder,
  onNavigate,
  enabled = true,
}: UseTouchPageSwipeOptions) {
  const start = useRef<TouchStart | null>(null);

  const onTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (!enabled || event.touches.length !== 1 || shouldIgnoreSwipe(event.target, event.currentTarget)) {
        start.current = null;
        return;
      }
      const touch = event.touches[0];
      start.current = { x: touch.clientX, y: touch.clientY };
    },
    [enabled],
  );

  const onTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const origin = start.current;
      start.current = null;
      if (!enabled || !origin || event.changedTouches.length !== 1) return;

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - origin.x;
      const deltaY = touch.clientY - origin.y;
      if (
        Math.abs(deltaX) < MIN_SWIPE_DISTANCE ||
        Math.abs(deltaX) < Math.abs(deltaY) * 1.25
      ) {
        return;
      }

      const currentIndex = navigationOrder.indexOf(activeView);
      if (currentIndex < 0) return;
      const nextIndex = currentIndex + (deltaX < 0 ? 1 : -1);
      const nextView = navigationOrder[nextIndex];
      if (nextView) onNavigate(nextView);
    },
    [activeView, enabled, navigationOrder, onNavigate],
  );

  const onTouchCancel = useCallback(() => {
    start.current = null;
  }, []);

  return { onTouchStart, onTouchEnd, onTouchCancel };
}
