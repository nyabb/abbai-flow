import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, screen, within } from '@testing-library/react';
import { TimerDock } from '../TimerDock';
import { I18nContext, createI18n } from '../../i18n';
import { resetTimerStoreForTests } from '../../hooks/useTimers';

const EN = createI18n('en');

function renderDock() {
  const onOpen = vi.fn();
  const view = render(
    <I18nContext.Provider value={EN}>
      <TimerDock onOpen={onOpen} />
    </I18nContext.Provider>,
  );
  return { ...view, onOpen };
}

const running = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'Pasta',
  totalMs: 5 * 60_000,
  endsAt: Date.now() + 4 * 60_000,
  remainingMs: 4 * 60_000,
  running: true,
  finished: false,
  ...overrides,
});

beforeEach(() => {
  resetTimerStoreForTests();
});

afterEach(() => {
  resetTimerStoreForTests();
});

describe('TimerDock', () => {
  it('stays out of the way when nothing is running', () => {
    const { container } = renderDock();
    expect(container.querySelector('.timer-dock')).toBeNull();
  });

  it('collapses to one chip showing the countdown that rings first', () => {
    resetTimerStoreForTests({
      timers: [
        running({ id: 't1', name: 'Pasta', endsAt: Date.now() + 4 * 60_000 }),
        running({ id: 't2', name: 'Oven', endsAt: Date.now() + 60_000 }),
      ],
    });
    const { container } = renderDock();

    const toggle = container.querySelector<HTMLButtonElement>('.timer-dock-toggle')!;
    // The nearest timer (1 minute) wins the chip, not the 4-minute one; the
    // badge says how many timers the chip stands for.
    expect(within(toggle).getByText(/^\d:\d\d$/).textContent).toBe('1:00');
    expect(container.querySelector('.timer-dock-count')?.textContent).toBe('2');
    // Collapsed: no list until it is opened.
    expect(container.querySelector('.timer-dock-panel')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('lists every timer and lets each one be paused or deleted without leaving the page', () => {
    resetTimerStoreForTests({
      timers: [running({ id: 't1', name: 'Pasta' }), running({ id: 't2', name: 'Oven' })],
    });
    const { container } = renderDock();

    fireEvent.click(container.querySelector<HTMLButtonElement>('.timer-dock-toggle')!);
    const panel = container.querySelector<HTMLElement>('.timer-dock-panel')!;
    expect(panel).not.toBeNull();
    expect(within(panel).getByText('Pasta')).not.toBeNull();
    expect(within(panel).getByText('Oven')).not.toBeNull();

    // Stop: the row switches to resume and stops being "running".
    fireEvent.click(within(panel).getByRole('button', { name: 'Pause: Pasta' }));
    expect(within(panel).getByRole('button', { name: 'Resume: Pasta' })).not.toBeNull();

    // Delete: the timer is gone from the list entirely.
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove: Oven' }));
    expect(within(panel).queryByText('Oven')).toBeNull();
    expect(within(panel).getByText('Pasta')).not.toBeNull();
  });

  it('offers to dismiss a finished timer, which is what stops the alarm', () => {
    resetTimerStoreForTests({
      timers: [
        running({
          id: 't1',
          name: 'Pasta',
          running: false,
          finished: true,
          endsAt: 0,
          remainingMs: 0,
        }),
      ],
    });
    const { container } = renderDock();

    // The collapsed chip already advertises the alarm.
    const toggle = container.querySelector<HTMLButtonElement>('.timer-dock-toggle')!;
    expect(toggle.className).toContain('is-ringing');

    fireEvent.click(toggle);
    const panel = container.querySelector<HTMLElement>('.timer-dock-panel')!;
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss alarm: Pasta' }));

    // Dismissing stops the alarm and re-arms the timer at its full length, so
    // the chip goes quiet instead of vanishing mid-interaction.
    expect(container.querySelector('.timer-dock-toggle')?.className).not.toContain('is-ringing');
    expect(within(panel).getByRole('button', { name: 'Resume: Pasta' })).not.toBeNull();
  });

  it('closes on an outside click or Escape, and links to the timer page', () => {
    resetTimerStoreForTests({ timers: [running({ id: 't1', name: 'Pasta' })] });
    const { container, onOpen } = renderDock();

    fireEvent.click(container.querySelector<HTMLButtonElement>('.timer-dock-toggle')!);
    expect(container.querySelector('.timer-dock-panel')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.timer-dock-panel')).toBeNull();

    fireEvent.click(container.querySelector<HTMLButtonElement>('.timer-dock-toggle')!);
    fireEvent.pointerDown(document.body);
    expect(container.querySelector('.timer-dock-panel')).toBeNull();

    fireEvent.click(container.querySelector<HTMLButtonElement>('.timer-dock-toggle')!);
    fireEvent.click(screen.getByRole('button', { name: 'Timer' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('includes a running stopwatch, which also lives outside the timer page', () => {
    resetTimerStoreForTests({
      stopwatch: { running: true, baseMs: 0, startedAt: Date.now() - 65_000, laps: [] },
    });
    const { container } = renderDock();

    fireEvent.click(container.querySelector<HTMLButtonElement>('.timer-dock-toggle')!);
    const panel = container.querySelector<HTMLElement>('.timer-dock-panel')!;
    expect(within(panel).getByText('Stopwatch')).not.toBeNull();
    expect(within(panel).getByRole('button', { name: 'Pause: Stopwatch' })).not.toBeNull();
  });
});
