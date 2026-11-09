import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { OmniAdd } from './OmniAdd';
import { I18nContext, createI18n } from '../i18n';

const NL = createI18n('nl');

function renderOmniAdd(props: Partial<React.ComponentProps<typeof OmniAdd>> = {}) {
  return render(
    <I18nContext.Provider value={NL}>
      <OmniAdd
        onAddEvent={vi.fn()}
        onAddGroceryItem={vi.fn()}
        onAddChore={vi.fn()}
        onAddRoutine={vi.fn()}
        onNavigateTimer={vi.fn()}
        showTrigger={false}
        {...props}
      />
    </I18nContext.Provider>,
  );
}

/**
 * The collapsed fan used to be only `opacity: 0`: the buttons stayed hit
 * testable and stole taps from whatever sat underneath them — the More sheet's
 * close X opened the Timer, and Save buttons in the bottom-right did nothing.
 */
describe('OmniAdd action fan', () => {
  it('is inert while collapsed', () => {
    const { container } = renderOmniAdd();
    const actions = container.querySelector('.omni-add-actions')!;

    expect(actions.hasAttribute('inert')).toBe(true);
    expect(actions.getAttribute('aria-hidden')).toBe('true');
    expect(actions.querySelectorAll('.omni-add-action')).toHaveLength(5);
  });

  it('becomes interactive when opened', () => {
    const { container, rerender } = renderOmniAdd({ open: false });
    const actions = container.querySelector('.omni-add-actions')!;
    expect(actions.hasAttribute('inert')).toBe(true);

    rerender(
      <I18nContext.Provider value={NL}>
        <OmniAdd
          onAddEvent={vi.fn()}
          onAddGroceryItem={vi.fn()}
          onAddChore={vi.fn()}
          onAddRoutine={vi.fn()}
          onNavigateTimer={vi.fn()}
          showTrigger={false}
          open
        />
      </I18nContext.Provider>,
    );

    const opened = container.querySelector('.omni-add-actions')!;
    expect(opened.hasAttribute('inert')).toBe(false);
    expect(opened.getAttribute('aria-hidden')).toBe('false');
  });

  it('runs the action and collapses again', () => {
    const onNavigateTimer = vi.fn();
    const onOpenChange = vi.fn();
    const { container } = renderOmniAdd({ open: true, onNavigateTimer, onOpenChange });

    const timer = [...container.querySelectorAll('.omni-add-action')].find((button) =>
      button.textContent?.includes('Timer'),
    )!;
    fireEvent.click(timer);

    expect(onNavigateTimer).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
