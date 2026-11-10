import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageHeader } from '../PageHeader';
import { I18nContext, createI18n } from '../../i18n';

const NL = createI18n('nl');

function renderHeader(props: Parameters<typeof PageHeader>[0]) {
  return render(
    <I18nContext.Provider value={NL}>
      <PageHeader {...props} />
    </I18nContext.Provider>,
  );
}

describe('PageHeader', () => {
  it('renders the title as the page heading', () => {
    renderHeader({ title: 'Timer' });

    expect(screen.getByRole('heading', { level: 1, name: 'Timer' })).toBeInTheDocument();
  });

  it('shows the subtitle when given one', () => {
    renderHeader({ title: 'Timer', subtitle: 'maandag 10 november' });

    expect(screen.getByText('maandag 10 november')).toBeInTheDocument();
  });

  it('only offers a back button when a handler is passed', () => {
    const { rerender } = renderHeader({ title: 'Timer' });
    expect(screen.queryByRole('button')).toBeNull();

    const onBack = vi.fn();
    rerender(
      <I18nContext.Provider value={NL}>
        <PageHeader title="Timer" onBack={onBack} />
      </I18nContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: NL.t('common.back') }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders right-hand actions', () => {
    renderHeader({ title: 'Timer', actions: <span>actie</span> });

    expect(screen.getByText('actie')).toBeInTheDocument();
  });

  /*
   * The band dates the page rather than only naming it: on a wall display the
   * day numeral is the largest thing on screen. The weekday is locale-derived,
   * so it is asserted as present rather than pinned to a calendar fact.
   */
  it('leads with the date block: weekday, day numeral and month', () => {
    const { container } = renderHeader({ title: 'Timer', date: new Date(2026, 10, 10) });

    expect(container.querySelector('.page-header-day')?.textContent).toBe('10');
    expect(container.querySelector('.page-header-month')?.textContent).toBe('november');
    expect(container.querySelector('.page-header-weekday')?.textContent?.trim()).toBeTruthy();
  });

  /* Every page carries a live clock, so the band never needs one passed in. */
  it('shows its own clock unless the view supplies one', () => {
    const { container, rerender } = renderHeader({ title: 'Timer' });
    expect(container.querySelector('.clock-mini')).not.toBeNull();

    rerender(
      <I18nContext.Provider value={NL}>
        <PageHeader title="Timer" hideClock />
      </I18nContext.Provider>,
    );
    expect(container.querySelector('.clock-mini')).toBeNull();
  });
});
