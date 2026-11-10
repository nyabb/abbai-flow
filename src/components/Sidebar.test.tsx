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
      'Timer',
      'Meer',
    ]);
  });

  it('offers the timer in the bar and keeps photos one tap away', () => {
    const { container } = renderSidebar(() => {});
    const labels = [...container.querySelectorAll('.mobile-tab')].map((item) =>
      item.getAttribute('aria-label'),
    );

    expect(labels).toContain('Timer');
    expect(labels).not.toContain("Foto's");
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

  it('lists only the views that are not on the bar, and closes after choosing one', () => {
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
    expect(entries).toEqual(['Muziek', "Foto's", 'Weer', 'Instellingen']);
    // Nothing that already has a slot on the bar may be repeated in the menu.
    expect(entries).not.toContain('Lijsten');
    expect(entries).not.toContain('Timer');
    expect(entries).not.toContain('Taken');

    fireEvent.click(within(menu).getByText("Foto's"));
    expect(onChangeView).toHaveBeenCalledWith('photos');
    expect(container.querySelector('.mobile-more-menu')).toBeNull();
  });
});

/**
 * Desktop has no overflow sheet, so a view that leaves the main group has to
 * appear somewhere else or it becomes unreachable.
 */
describe('Sidebar desktop', () => {
  it('keeps photos in the bottom group and the timer in the main group', () => {
    const { container } = renderSidebar(() => {});
    const main = container.querySelector(
      '.sidebar--desktop .sidebar-nav-group:not(.sidebar-nav-group--bottom)',
    )!;
    const bottom = container.querySelector('.sidebar--desktop .sidebar-nav-group--bottom')!;
    const labels = (group: Element) =>
      [...group.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));

    expect(labels(main)).toContain('Timer');
    expect(labels(main)).not.toContain("Foto's");
    expect(labels(bottom)).toContain("Foto's");
    expect(labels(bottom)).toContain('Instellingen');
  });
});
