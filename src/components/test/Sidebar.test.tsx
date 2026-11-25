import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sidebar, type SidebarView } from '../Sidebar';
import { I18nContext, createI18n } from '../../i18n';
import { TOUCH_NAV_ORDER } from '../../utils/touch-navigation';

const NL = createI18n('nl');

function renderSidebar(activeView: SidebarView = 'calendar', onQuickAdd?: () => void) {
  return render(
    <I18nContext.Provider value={NL}>
      <Sidebar activeView={activeView} onChangeView={() => {}} onQuickAdd={onQuickAdd} />
    </I18nContext.Provider>,
  );
}

/** The bottom bar keeps all seven views directly reachable. */
describe('Sidebar bottom bar', () => {
  it('shows all seven pages in the requested order without a permanently featured page', () => {
    const { container } = renderSidebar('calendar', () => {});
    const bar = container.querySelector('.mobile-tab-bar')!;
    const items = [...bar.querySelectorAll('.mobile-tab')];

    expect(items).toHaveLength(7);
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Agenda',
      'Maaltijden',
      'Lijsten',
      'Klusjes',
      'Muziek',
      'Weer',
      'Timer',
    ]);
    expect(items.every((item) => !item.classList.contains('mobile-tab--featured'))).toBe(true);
  });

  it('moves the curved highlight and magnification to the selected page', () => {
    const { container } = renderSidebar('grocery');
    const bar = container.querySelector('.mobile-tab-bar')!;
    const activeTab = bar.querySelector('.mobile-tab--active')!;

    expect(activeTab).toHaveAttribute('aria-label', 'Lijsten');
    expect(bar.style.getPropertyValue('--mobile-active-center')).toBe('35.714285714285715%');
    expect(bar.style.getPropertyValue('--mobile-bump-width')).toContain('min(240px');
  });

  it('does not put quick add or a More popup in the navigation bar', () => {
    const { container } = renderSidebar('calendar', () => {});
    expect(container.querySelector('.mobile-tab--add')).toBeNull();
    expect(container.querySelector('.mobile-more-menu')).toBeNull();
  });
});

/** Desktop keeps page links in the main group and its bottom utility group. */
describe('Sidebar desktop', () => {
  it('keeps the timer in the main group and weather in the bottom group', () => {
    const { container } = renderSidebar('calendar', () => {});
    const main = container.querySelector(
      '.sidebar--desktop .sidebar-nav-group:not(.sidebar-nav-group--bottom)',
    )!;
    const bottom = container.querySelector('.sidebar--desktop .sidebar-nav-group--bottom')!;
    const labels = (group: Element) =>
      [...group.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));

    expect(labels(main)).toContain('Timer');
    expect(labels(main)).not.toContain("Foto's");
    expect(labels(bottom)).toContain('Maaltijden');
    expect(labels(bottom)).toContain('Weer');
    expect(labels(bottom)).toContain('Instellingen');
  });
});

describe('touch navigation order', () => {
  it('follows the mobile bar and the Settings shortcut', () => {
    expect(TOUCH_NAV_ORDER).toEqual([
      'calendar',
      'meals',
      'grocery',
      'chores',
      'music',
      'weather',
      'timer',
      'settings',
    ]);
  });
});
