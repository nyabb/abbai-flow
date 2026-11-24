import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTouchPageSwipe } from './useTouchPageSwipe';
import type { SidebarView } from '../components/Sidebar';

const navigationOrder: SidebarView[] = [
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

function TouchSwipeHarness({
  activeView = 'calendar',
  enabled = true,
  onNavigate,
}: {
  activeView?: SidebarView;
  enabled?: boolean;
  onNavigate: (view: SidebarView) => void;
}) {
  const handlers = useTouchPageSwipe({
    activeView,
    enabled,
    navigationOrder,
    onNavigate,
  });

  return (
    <div data-testid="page" {...handlers}>
      <span data-testid="content">Page content</span>
      <button data-testid="button" type="button">Control</button>
      <div data-testid="scroller" style={{ overflowX: 'auto' }}>
        <span data-testid="scroller-child">Scrollable content</span>
      </div>
    </div>
  );
}

function dispatchTouch(target: Element, type: 'touchstart' | 'touchend', x: number, y: number) {
  const touchPoint = { identifier: 1, clientX: x, clientY: y, target };
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'touches', { value: type === 'touchstart' ? [touchPoint] : [] });
  Object.defineProperty(event, 'changedTouches', { value: [touchPoint] });
  fireEvent(target, event);
}

function swipe(target: Element, startX: number, startY: number, endX: number, endY: number) {
  dispatchTouch(target, 'touchstart', startX, startY);
  dispatchTouch(target, 'touchend', endX, endY);
}

describe('useTouchPageSwipe', () => {
  it('moves to the next page on a left swipe and previous page on a right swipe', () => {
    const onNavigate = vi.fn();
    const { getByTestId, rerender } = render(<TouchSwipeHarness onNavigate={onNavigate} />);
    const content = getByTestId('content');

    swipe(content, 220, 100, 120, 106);
    expect(onNavigate).toHaveBeenLastCalledWith('chores');

    rerender(<TouchSwipeHarness activeView="chores" onNavigate={onNavigate} />);
    swipe(content, 120, 100, 220, 106);
    expect(onNavigate).toHaveBeenLastCalledWith('calendar');
  });

  it('does not navigate for vertical gestures or gestures on controls', () => {
    const onNavigate = vi.fn();
    const { getByTestId } = render(<TouchSwipeHarness onNavigate={onNavigate} />);

    swipe(getByTestId('content'), 100, 100, 105, 220);
    swipe(getByTestId('button'), 220, 100, 100, 100);

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate from a horizontally scrollable region', () => {
    const onNavigate = vi.fn();
    const { getByTestId } = render(<TouchSwipeHarness onNavigate={onNavigate} />);
    const scroller = getByTestId('scroller');
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, value: 220 },
    });

    swipe(getByTestId('scroller-child'), 220, 100, 100, 100);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('respects disabled navigation and stops at the ends of the page order', () => {
    const onNavigate = vi.fn();
    const { getByTestId, rerender } = render(
      <TouchSwipeHarness enabled={false} onNavigate={onNavigate} />,
    );
    swipe(getByTestId('content'), 220, 100, 100, 100);

    rerender(<TouchSwipeHarness activeView="settings" onNavigate={onNavigate} />);
    swipe(getByTestId('content'), 220, 100, 100, 100);
    expect(onNavigate).not.toHaveBeenCalled();

    rerender(<TouchSwipeHarness activeView="calendar" onNavigate={onNavigate} />);
    swipe(getByTestId('content'), 100, 100, 220, 100);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
