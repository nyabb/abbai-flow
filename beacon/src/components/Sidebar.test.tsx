import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, within } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { I18nContext, createI18n } from '../i18n';

const NL = createI18n('nl');

function renderSidebar(onQuickAdd?: () => void) {
  return render(
    <I18nContext.Provider value={NL}>
      <Sidebar activeView="dashboard" onChangeView={() => {}} onQuickAdd={onQuickAdd} />
    </I18nContext.Provider>,
  );
}

/** The bottom bar is seven buttons with quick add dead centre. */
describe('Sidebar bottom bar', () => {
  it('has seven elements with quick add in the middle', () => {
    const { container } = renderSidebar(() => {});
    const bar = container.querySelector('.mobile-tab-bar')!;
    const items = [...bar.querySelectorAll('.mobile-tab')];

    expect(items).toHaveLength(7);
    expect(items[3].classList.contains('mobile-tab--add')).toBe(true);
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Dashboard',
      'Agenda',
      'Klusjes',
      'Snel toevoegen',
      'Lijsten',
      "Foto's",
      'Meer',
    ]);
  });

  it('offers lists where music used to sit', () => {
    const { container } = renderSidebar(() => {});
    const labels = [...container.querySelectorAll('.mobile-tab')].map((item) =>
      item.getAttribute('aria-label'),
    );

    expect(labels).toContain('Lijsten');
    expect(labels).not.toContain('Muziek');
  });

  it('calls quick add from the middle button', () => {
    const onQuickAdd = vi.fn();
    const { container } = renderSidebar(onQuickAdd);

    fireEvent.click(container.querySelectorAll('.mobile-tab')[3]);
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
  });
});

/**
 * The overflow menu used to swallow the close tap: the button sat under the
 * first item, so pressing the X opened that view instead of closing the sheet.
 */
describe('Sidebar overflow menu', () => {
  it('closes from its own close button', () => {
    const onChangeView = vi.fn();
    const { container } = render(
      <I18nContext.Provider value={NL}>
        <Sidebar activeView="dashboard" onChangeView={onChangeView} onQuickAdd={() => {}} />
      </I18nContext.Provider>,
    );

    fireEvent.click(container.querySelector('button[aria-label="Meer"]')!);
    expect(container.querySelector('.mobile-more-menu')).not.toBeNull();

    const close = screen.getByRole('button', { name: 'Menu sluiten' });
    fireEvent.click(close);

    expect(container.querySelector('.mobile-more-menu')).toBeNull();
    // Closing must never navigate anywhere.
    expect(onChangeView).not.toHaveBeenCalled();
  });

  it('lists every view that left the bar, and closes after choosing one', () => {
    const onChangeView = vi.fn();
    const { container } = render(
      <I18nContext.Provider value={NL}>
        <Sidebar activeView="dashboard" onChangeView={onChangeView} onQuickAdd={() => {}} />
      </I18nContext.Provider>,
    );

    fireEvent.click(container.querySelector('button[aria-label="Meer"]')!);
    const menu = container.querySelector<HTMLElement>('.mobile-more-menu')!;
    const entries = [...menu.querySelectorAll('.mobile-more-item')].map((item) =>
      item.textContent?.trim(),
    );
    expect(entries).toContain('Muziek');
    expect(entries).toContain('Taken');
    expect(entries).toContain('Timer');
    expect(entries).toContain('Weer');
    expect(entries).toContain('Instellingen');

    fireEvent.click(within(menu).getByText('Timer'));
    expect(onChangeView).toHaveBeenCalledWith('timer');
    expect(container.querySelector('.mobile-more-menu')).toBeNull();
  });
});
