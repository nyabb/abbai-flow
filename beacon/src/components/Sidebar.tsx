import { useState } from 'react';
import {
  LayoutDashboard,
  Calendar,
  ListChecks,
  ShoppingCart,
  ClipboardList,
  Music,
  Image,
  Settings,
  Timer as TimerIcon,
  CloudSun,
  MoreHorizontal,
  Plus,
  X,
} from 'lucide-react';
import beaconIcon from '../assets/beacon-app-icon.svg';
import { useTranslation, type TranslationKey } from '../i18n';

export type SidebarView =
  | 'dashboard'
  | 'calendar'
  | 'chores'
  | 'grocery'
  | 'tasks'
  | 'music'
  | 'photos'
  | 'timer'
  | 'weather'
  | 'settings';

interface SidebarProps {
  activeView: SidebarView;
  onChangeView: (view: SidebarView) => void;
  position?: 'left' | 'right' | 'bottom';
  /** Opens quick-add (chore, routine, event, ...) from the middle of the tab bar. */
  onQuickAdd?: () => void;
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
    id: 'dashboard',
    icon: <LayoutDashboard size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.dashboard',
  },
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
    id: 'tasks',
    icon: <ClipboardList size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.tasks',
  },
  {
    id: 'music',
    icon: <Music size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.music',
  },
  {
    id: 'photos',
    icon: <Image size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.photos',
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
];

/**
 * The bar is seven elements with quick add dead centre: three views on the left,
 * the add button, three views on the right. Lists replaces Music in the bar and
 * everything else stays one tap away in the overflow menu.
 */
const NAV_LEFT_IDS: SidebarView[] = ['dashboard', 'calendar', 'chores'];
const NAV_RIGHT_IDS: SidebarView[] = ['grocery', 'photos', 'music'];
/** The right side on phones: the last slot is the overflow menu. */
const MOBILE_RIGHT_IDS: SidebarView[] = ['grocery', 'photos'];
/** Desktop keeps these below the divider, next to Settings. */
const NAV_EXTRA_IDS: SidebarView[] = ['tasks', 'timer', 'weather'];

export function Sidebar({
  activeView,
  onChangeView,
  position = 'left',
  onQuickAdd,
}: SidebarProps) {
  const { t } = useTranslation();
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const itemFor = (id: SidebarView) => NAV_ITEMS.find((item) => item.id === id)!;
  const navLeft = NAV_LEFT_IDS.map(itemFor);
  const navRight = NAV_RIGHT_IDS.map(itemFor);
  const mobileRight = MOBILE_RIGHT_IDS.map(itemFor);
  const navExtra = NAV_EXTRA_IDS.map(itemFor);
  const quickAddLabel = t('omniAdd.quickAdd');

  const handleMobileNav = (view: SidebarView) => {
    onChangeView(view);
    setMobileMoreOpen(false);
  };

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        className={`sidebar sidebar--desktop sidebar--${position}`}
        aria-label={t('nav.mainNavigation')}
        style={position === 'bottom' ? { display: 'none' } : undefined}
      >
        {/* Beacon logo */}
        <div className="sidebar-logo">
          <img src={beaconIcon} alt="Beacon" width={32} height={32} />
        </div>

        {/* Main nav icons: three above the add button, three below it. */}
        <div className="sidebar-nav-group">
          {navLeft.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-icon ${activeView === item.id ? 'sidebar-icon--active' : ''}`}
              onClick={() => onChangeView(item.id)}
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
            >
              {item.icon}
            </button>
          ))}
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
          {navRight.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-icon ${activeView === item.id ? 'sidebar-icon--active' : ''}`}
              onClick={() => onChangeView(item.id)}
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
            >
              {item.icon}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="sidebar-divider" />

        {/* Bottom utility icons */}
        <div className="sidebar-nav-group sidebar-nav-group--bottom">
          {navExtra.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-icon ${activeView === item.id ? 'sidebar-icon--active' : ''}`}
              onClick={() => onChangeView(item.id)}
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
            >
              {item.icon}
            </button>
          ))}
          <button
            type="button"
            className={`sidebar-icon ${activeView === 'settings' ? 'sidebar-icon--active' : ''}`}
            onClick={() => onChangeView('settings')}
            title={t('nav.settings')}
            aria-label={t('nav.settings')}
          >
            <Settings size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
          </button>
        </div>
      </nav>

      {/* Mobile bottom tab bar (hidden on desktop via CSS) */}
      <nav className="mobile-tab-bar" aria-label={t('nav.mainNavigation')}>
        {/* Three views, the add button dead centre, then three more. */}
        {navLeft.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mobile-tab ${activeView === item.id ? 'mobile-tab--active' : ''}`}
            onClick={() => handleMobileNav(item.id)}
            aria-label={t(item.labelKey)}
          >
            {item.icon}
            <span className="mobile-tab-label">{t(item.labelKey)}</span>
          </button>
        ))}
        {onQuickAdd && (
          <button
            type="button"
            className="mobile-tab mobile-tab--add"
            onClick={onQuickAdd}
            aria-label={quickAddLabel}
          >
            <Plus size={ICON_SIZE + 6} strokeWidth={2} />
          </button>
        )}
        {mobileRight.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mobile-tab ${activeView === item.id ? 'mobile-tab--active' : ''}`}
            onClick={() => handleMobileNav(item.id)}
            aria-label={t(item.labelKey)}
          >
            {item.icon}
            <span className="mobile-tab-label">{t(item.labelKey)}</span>
          </button>
        ))}
        {/* More button */}
        <button
          type="button"
          className={`mobile-tab ${mobileMoreOpen ? 'mobile-tab--active' : ''}`}
          onClick={() => setMobileMoreOpen((prev) => !prev)}
          aria-label={t('nav.more')}
        >
          <MoreHorizontal size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
          <span className="mobile-tab-label">{t('nav.more')}</span>
        </button>

        {/* Overflow menu */}
        {mobileMoreOpen && (
          <>
            <div className="mobile-more-backdrop" onClick={() => setMobileMoreOpen(false)} />
            <div className="mobile-more-menu">
              <div className="mobile-more-header">
                <span className="mobile-more-title">{t('nav.more')}</span>
                <button
                  type="button"
                  className="mobile-more-close"
                  onClick={() => setMobileMoreOpen(false)}
                  aria-label={t('nav.closeMenu')}
                >
                  <X size={20} strokeWidth={2} />
                </button>
              </div>
              {[...mobileRight.filter((item) => item.id === 'music'), ...navExtra].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`mobile-more-item ${activeView === item.id ? 'mobile-more-item--active' : ''}`}
                  onClick={() => handleMobileNav(item.id)}
                >
                  {item.icon}
                  <span>{t(item.labelKey)}</span>
                </button>
              ))}
              <button
                type="button"
                className={`mobile-more-item ${activeView === 'settings' ? 'mobile-more-item--active' : ''}`}
                onClick={() => handleMobileNav('settings')}
              >
                <Settings size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
                <span>{t('nav.settings')}</span>
              </button>
            </div>
          </>
        )}
      </nav>
    </>
  );
}
