import { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  ListChecks,
  Music,
  MoreHorizontal,
  ShoppingCart,
  Settings,
  Timer as TimerIcon,
  CloudSun,
  Utensils,
  Plus,
} from 'lucide-react';
import abbaiIcon from '../assets/abbai-flow-icon.svg';
import { useTranslation, type TranslationKey } from '../i18n';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { SettingsErrorBadge } from './SettingsErrorBadge';

export type SidebarView =
  | 'calendar'
  | 'chores'
  | 'grocery'
  | 'meals'
  | 'music'
  | 'timer'
  | 'weather'
  | 'settings';

interface SidebarProps {
  activeView: SidebarView;
  onChangeView: (view: SidebarView) => void;
  position?: 'left' | 'right' | 'bottom';
  /** Opens quick-add from the desktop sidebar. Mobile uses the OmniAdd FAB. */
  onQuickAdd?: () => void;
  hasSettingsAttention?: boolean;
}

const ICON_SIZE = 24;
const STROKE_WIDTH = 1.5;

interface NavItem {
  id: SidebarView;
  icon: React.ReactNode;
  labelKey: TranslationKey;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'calendar',
    icon: <Calendar size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.calendar',
  },
  {
    id: 'chores',
    icon: <ListChecks size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.chores',
  },
  {
    id: 'grocery',
    icon: <ShoppingCart size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.grocery',
  },
  {
    id: 'meals',
    icon: <Utensils size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.meals',
  },
  {
    id: 'music',
    icon: <Music size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.music',
  },
  {
    id: 'timer',
    icon: <TimerIcon size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.timer',
  },
  {
    id: 'weather',
    icon: <CloudSun size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.weather',
  },
  {
    id: 'settings',
    icon: <Settings size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.settings',
  },
];

/** Keep the same page order in the desktop rail and full bottom bar. */
const MOBILE_NAV_IDS: SidebarView[] = [
  'calendar',
  'meals',
  'grocery',
  'chores',
  'music',
  'weather',
  'timer',
];
/** Narrow phones keep the four household destinations visible, with Chores centered. */
const COMPACT_NAV_IDS: SidebarView[] = ['calendar', 'meals', 'chores', 'grocery'];
const COMPACT_MORE_IDS: SidebarView[] = ['music', 'weather', 'timer'];

export function Sidebar({
  activeView,
  onChangeView,
  position = 'left',
  onQuickAdd,
  hasSettingsAttention = false,
}: SidebarProps) {
  const { t } = useTranslation();
  const compactPhone = useMediaQuery('(max-width: 480px)');
  const portraitDisplay = useMediaQuery(
    '(min-width: 900px) and (min-height: 1200px) and (orientation: portrait)',
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRootRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const itemFor = (id: SidebarView) => NAV_ITEMS.find((item) => item.id === id)!;
  const desktopNav = MOBILE_NAV_IDS.map(itemFor);
  const mobileNavIds = compactPhone ? COMPACT_NAV_IDS : MOBILE_NAV_IDS;
  const mobileNav = mobileNavIds.map(itemFor);
  if (portraitDisplay && !compactPhone) mobileNav.push(itemFor('settings'));
  const moreNav = COMPACT_MORE_IDS.map(itemFor);
  const quickAddLabel = t('omniAdd.quickAdd');
  const activeViewInMore = COMPACT_MORE_IDS.includes(activeView);

  useEffect(() => {
    if (!moreOpen) return;

    const closeIfOutside = (event: PointerEvent) => {
      if (!moreRootRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeIfOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!compactPhone) setMoreOpen(false);
  }, [compactPhone]);

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        className={`sidebar sidebar--desktop sidebar--${position}`}
        aria-label={t('nav.mainNavigation')}
        style={position === 'bottom' ? { display: 'none' } : undefined}
      >
        {/* Abbai Flow logo */}
        <div className="sidebar-logo">
          <img src={abbaiIcon} alt="Abbai Flow" width={32} height={32} />
        </div>

        {/* Page links use the same order as the bottom bar. */}
        <div className="sidebar-nav-group">
          {desktopNav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-icon ${activeView === item.id ? 'sidebar-icon--active' : ''}`}
              onClick={() => onChangeView(item.id)}
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
              aria-current={activeView === item.id ? 'page' : undefined}
            >
              {item.icon}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="sidebar-divider" />

        {/* Quick Add and Settings stay in the utility area. */}
        <div className="sidebar-nav-group sidebar-nav-group--bottom">
          {onQuickAdd && (
            <button
              type="button"
              className="sidebar-icon sidebar-icon--add"
              onClick={onQuickAdd}
              title={quickAddLabel}
              aria-label={quickAddLabel}
            >
              <Plus size={ICON_SIZE} strokeWidth={2} />
            </button>
          )}
          <button
            type="button"
            className={`sidebar-icon ${activeView === 'settings' ? 'sidebar-icon--active' : ''}`}
            onClick={() => onChangeView('settings')}
            title={t('nav.settings')}
            aria-label={t('nav.settings')}
            aria-current={activeView === 'settings' ? 'page' : undefined}
          >
            <Settings size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
            {hasSettingsAttention && (
              <SettingsErrorBadge
                label={t('settings.integrations.needsAttention')}
                className="settings-error-badge--floating"
              />
            )}
          </button>
        </div>
      </nav>

      {/* Seven destinations stay visible on larger screens. Narrow phones use
          four direct links and a compact More menu for the other three. */}
      <nav className="mobile-tab-bar" aria-label={t('nav.mainNavigation')}>
        {mobileNav.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mobile-tab ${activeView === item.id ? 'mobile-tab--active' : ''}`}
            onClick={() => onChangeView(item.id)}
            aria-label={t(item.labelKey)}
            aria-current={activeView === item.id ? 'page' : undefined}
          >
            {item.icon}
            {item.id === 'settings' && hasSettingsAttention && (
              <SettingsErrorBadge
                label={t('settings.integrations.needsAttention')}
                className="settings-error-badge--floating"
              />
            )}
            <span className="mobile-tab-label">{t(item.labelKey)}</span>
          </button>
        ))}
        {compactPhone && (
          <div className="mobile-tab-more" ref={moreRootRef}>
            <button
              ref={moreButtonRef}
              type="button"
              className={`mobile-tab mobile-tab--more${activeViewInMore ? ' mobile-tab--active' : ''}`}
              onClick={() => setMoreOpen((open) => !open)}
              aria-label={t('nav.more')}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-current={activeViewInMore ? 'page' : undefined}
            >
              <MoreHorizontal size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
              <span className="mobile-tab-label">{t('nav.more')}</span>
            </button>
            {moreOpen && (
              <div className="mobile-more-menu" role="menu" aria-label={t('nav.more')}>
                {moreNav.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className={`mobile-more-menu-item${activeView === item.id ? ' is-active' : ''}`}
                    onClick={() => {
                      onChangeView(item.id);
                      setMoreOpen(false);
                    }}
                    aria-current={activeView === item.id ? 'page' : undefined}
                  >
                    {item.icon}
                    <span>{t(item.labelKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>
    </>
  );
}
