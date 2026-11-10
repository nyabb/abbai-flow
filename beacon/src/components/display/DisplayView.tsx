/**
 * Display Mode — the wall-mounted touchscreen view (`/display`).
 *
 * Built for a Chromium kiosk sitting 2-3 m away on a Raspberry Pi: one clock and
 * date band, then large panels for today's agenda, today's chores and the
 * family, plus a touch-sized row of navigation targets.
 *
 * It composes existing pieces (Clock ticker, MemberAvatar, ChoreOps types and
 * the shared `isChoreDone` helper) rather than re-deriving anything, and it is
 * read-only: a wall screen is bumped constantly, so nothing here mutates data.
 * Wake Lock, fullscreen and the inactivity timeout are layered on top by
 * `useDisplayMode`, not here.
 */
import { format } from 'date-fns';
import { CalendarDays, CheckSquare, LayoutDashboard, Maximize2, Minimize2, ShoppingCart } from 'lucide-react';
import { useTranslation, type TranslationKey } from '../../i18n';
import { DisplayAgenda } from './DisplayAgenda';
import { DisplayChores } from './DisplayChores';
import { DisplayFamily } from './DisplayFamily';
import { useNow } from './useNow';
import { DEFAULT_DISPLAY_PANELS, type DisplayConnection, type DisplayPanelFlags } from './types';
import type { CalendarEvent, WeatherData } from '../../types';
import type { ChoreOpsChore, ChoreOpsUser } from '../../types/choreops';
import type { FamilyMember } from '../../types/family';
import type { SidebarView } from '../Sidebar';

export type { DisplayConnection, DisplayPanelFlags } from './types';

export interface DisplayFullscreenControl {
  /** False when the browser cannot enter fullscreen programmatically. */
  supported: boolean;
  active: boolean;
  onToggle: () => void;
}

export interface DisplayViewProps {
  events: CalendarEvent[];
  chores: ChoreOpsChore[];
  users: ChoreOpsUser[];
  members: FamilyMember[];
  weather: WeatherData | null;
  timeFormat: '12h' | '24h';
  connection: DisplayConnection;
  /** Panels to render; defaults to all four. */
  panels?: Partial<DisplayPanelFlags>;
  /** Fullscreen toggle; omitted when the browser has no Fullscreen API. */
  fullscreen?: DisplayFullscreenControl;
  onNavigate?: (view: SidebarView) => void;
}

const NAV_TARGETS = [
  { view: 'dashboard' as const, labelKey: 'nav.dashboard' as const, Icon: LayoutDashboard },
  { view: 'calendar' as const, labelKey: 'nav.calendar' as const, Icon: CalendarDays },
  { view: 'chores' as const, labelKey: 'nav.chores' as const, Icon: CheckSquare },
  { view: 'grocery' as const, labelKey: 'nav.grocery' as const, Icon: ShoppingCart },
];

const CONNECTION_LABEL: Record<DisplayConnection, TranslationKey> = {
  online: 'display.connection.online',
  'beacon-down': 'display.connection.beaconDown',
  'ha-down': 'display.connection.haDown',
  offline: 'display.connection.offline',
};

export function DisplayView({
  events,
  chores,
  users,
  members,
  weather,
  timeFormat,
  connection,
  panels = DEFAULT_DISPLAY_PANELS,
  fullscreen,
  onNavigate,
}: DisplayViewProps) {
  const { t, dateLocale } = useTranslation();
  // A wall clock only needs the minute; the seconds are noise at 3 m.
  const now = useNow(1000);
  const show = { ...DEFAULT_DISPLAY_PANELS, ...panels };

  const time = format(now, timeFormat === '12h' ? 'h:mm' : 'HH:mm');
  const meridiem = timeFormat === '12h' ? format(now, 'a') : '';
  const dateLine = format(now, 'EEEE d MMMM', { locale: dateLocale });

  return (
    <div className="display-view">
      <header className="display-band">
        <div className="display-clock">
          <span className="display-clock-time">
            {time}
            {meridiem && <span className="display-clock-meridiem">{meridiem}</span>}
          </span>
          <span className="display-clock-date">{dateLine}</span>
        </div>

        <div className="display-band-right">
          {show.weather && weather && (
            <div className="display-weather">
              <span className="display-weather-temp">
                {Math.round(weather.temperature)}
                {weather.temperatureUnit}
              </span>
              <span className="display-weather-condition">{weather.condition}</span>
            </div>
          )}
          <div
            className={`display-connection display-connection--${connection}`}
            role="status"
            aria-live="polite"
          >
            <span className="display-connection-dot" aria-hidden="true" />
            {t(CONNECTION_LABEL[connection])}
          </div>
          {fullscreen?.supported && (
            <button
              type="button"
              className="display-fullscreen"
              onClick={fullscreen.onToggle}
              aria-pressed={fullscreen.active}
              aria-label={t(
                fullscreen.active ? 'display.exitFullscreen' : 'display.enterFullscreen',
              )}
            >
              {fullscreen.active ? (
                <Minimize2 size={20} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Maximize2 size={20} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </header>

      <div className={`display-panels display-panels--${panelCount(show)}`}>
        {show.agenda && (
          <DisplayAgenda events={events} day={now} timeFormat={timeFormat} now={now} />
        )}
        {show.chores && <DisplayChores chores={chores} members={members} />}
        {show.family && <DisplayFamily members={members} users={users} />}
      </div>

      {onNavigate && (
        <nav className="display-nav" aria-label={t('nav.mainNavigation')}>
          {NAV_TARGETS.map(({ view, labelKey, Icon }) => (
            <button
              key={view}
              type="button"
              className="display-nav-button"
              onClick={() => onNavigate(view)}
            >
              <Icon size={26} strokeWidth={2} aria-hidden="true" />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

/** Panels visible, so the grid can lay out 1-3 columns without gaps. */
function panelCount(panels: DisplayPanelFlags): number {
  return [panels.agenda, panels.chores, panels.family].filter(Boolean).length;
}
