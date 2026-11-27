import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sidebar, type SidebarView } from '../Sidebar';
import { I18nContext, createI18n } from '../../i18n';
import { TOUCH_NAV_ORDER } from '../../utils/touch-navigation';

const NL = createI18n('nl');

function renderSidebar(activeView: SidebarView = 'calendar') {
  return render(
    <I18nContext.Provider value={NL}>
      <Sidebar activeView={activeView} onChangeView={() => {}} />
    </I18nContext.Provider>,
  );
}

/** The bottom bar keeps all seven views directly reachable. */
describe('Sidebar bottom bar', () => {
  it('shows all seven pages in the requested order without a permanently featured page', () => {
    const { container } = renderSidebar('calendar');
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

  it('keeps the selected page highlighted without shifting the other tabs', () => {
    const { container } = renderSidebar('grocery');
    const bar = container.querySelector('.mobile-tab-bar')!;
    const activeTab = bar.querySelector('.mobile-tab--active')!;

    expect(activeTab).toHaveAttribute('aria-label', 'Lijsten');
    expect(activeTab).toHaveAttribute('aria-current', 'page');
    expect(bar.querySelector('.mobile-tab-bar-wave')).toBeNull();
  });

  it('does not put quick add or a More popup in the navigation bar', () => {
    const { container } = renderSidebar('calendar');
    expect(container.querySelector('.mobile-tab--add')).toBeNull();
    expect(container.querySelector('.mobile-more-menu')).toBeNull();
  });
});

/** The app never renders navigation in a side rail or puts Settings in the dock. */
describe('Sidebar desktop', () => {
  it('keeps the side rail and Settings destination out of navigation', () => {
    const { container } = renderSidebar('calendar');
    expect(container.querySelector('.sidebar--desktop')).toBeNull();
    expect(container.querySelector('.mobile-tab-bar [aria-label="Instellingen"]')).toBeNull();
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
