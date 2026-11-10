import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { format } from 'date-fns';
import { DisplayView } from '../display/DisplayView';
import { I18nContext, createI18n } from '../../i18n';
import type { CalendarEvent } from '../../types';
import type { ChoreOpsChore, ChoreOpsUser } from '../../types/choreops';
import type { FamilyMember } from '../../types/family';

/**
 * Display Mode is the screen a wall device sits on all day, so the cases pin
 * what it must show at a glance: today's agenda, chores per member with their
 * state, the family and their points, the weather, and why it is disconnected.
 *
 * The view is read-only by design — the only interactive elements are the four
 * navigation buttons — so nothing here asserts on chore actions.
 *
 * Panels are queried by their region label because several strings repeat
 * between a panel and the navigation ("Klusjes", member names).
 */
const NL = createI18n('nl');
const today = new Date();
const at = (hour: number) => {
  const date = new Date(today);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

const MEMBERS: FamilyMember[] = [
  { id: 'm1', name: 'Noor', avatar: '🦊', color: '#3b82f6', role: 'child' },
  { id: 'm2', name: 'Papa', avatar: '👨', color: '#10b981', role: 'parent' },
];

const USERS: ChoreOpsUser[] = [
  {
    name: 'Noor',
    slug: 'noor',
    points: 42,
    dueToday: 3,
    claimed: 1,
    approved: 1,
    completedToday: 2,
  },
];

function chore(overrides: Partial<ChoreOpsChore> = {}): ChoreOpsChore {
  return {
    id: 'c1',
    name: 'Tanden poetsen',
    icon: '🦷',
    status: 'pending',
    assignee: 'Noor',
    points: 5,
    actions: {},
    ...overrides,
  } as ChoreOpsChore;
}

const EVENTS: CalendarEvent[] = [
  {
    id: 'e1',
    title: 'School',
    start: at(8),
    end: at(15),
    allDay: false,
    calendarId: 'cal1',
    calendarName: 'Gezin',
    color: '#3b82f6',
  },
  {
    id: 'e2',
    title: 'Avondeten',
    start: at(18),
    end: at(19),
    allDay: false,
    calendarId: 'cal1',
    calendarName: 'Gezin',
    color: '#3b82f6',
  },
];

function renderDisplay(overrides: Partial<Parameters<typeof DisplayView>[0]> = {}) {
  const onNavigate = vi.fn();
  const utils = render(
    <I18nContext.Provider value={NL}>
      <DisplayView
        events={EVENTS}
        chores={[chore(), chore({ id: 'c2', name: 'Vaatwasser', status: 'approved' })]}
        users={USERS}
        members={MEMBERS}
        weather={{ temperature: 12.4, temperatureUnit: '°C', condition: 'Bewolkt', forecast: [] }}
        timeFormat="24h"
        connection="online"
        onNavigate={onNavigate}
        {...overrides}
      />
    </I18nContext.Provider>,
  );
  return { ...utils, onNavigate };
}

const panel = (name: string) => within(screen.getByRole('region', { name }));

describe('DisplayView', () => {
  it("shows today's date and the current time", () => {
    const { container } = renderDisplay();

    expect(
      screen.getByText(format(today, 'EEEE d MMMM', { locale: NL.dateLocale })),
    ).toBeInTheDocument();
    expect(container.querySelector('.display-clock-time')?.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it("lists today's events in time order", () => {
    renderDisplay();

    const titles = panel(NL.t('display.today'))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.display-agenda-title')?.textContent);

    expect(titles).toEqual(['School', 'Avondeten']);
  });

  it('groups chores per member and marks the completed ones', () => {
    renderDisplay();

    const chores = panel(NL.t('display.chores'));
    expect(chores.getByText(NL.t('display.choresDone', { done: 1, total: 2 }))).toBeInTheDocument();
    expect(chores.getByText('Tanden poetsen')).toBeInTheDocument();
    expect(chores.getByText('Vaatwasser')).toBeInTheDocument();
    expect(chores.getByText(NL.t('display.done'))).toBeInTheDocument();
    expect(chores.getByText(NL.t('display.open'))).toBeInTheDocument();
  });

  it('shows the family with ChoreOps points, and members without an account', () => {
    renderDisplay();

    const family = panel(NL.t('display.family'));
    expect(family.getByText('Noor')).toBeInTheDocument();
    expect(family.getByText('Papa')).toBeInTheDocument();
    expect(family.getByText(NL.t('display.points', { points: 42 }))).toBeInTheDocument();
    expect(family.getByText(NL.t('display.notLinked'))).toBeInTheDocument();
  });

  it('shows the current weather', () => {
    renderDisplay();

    expect(screen.getByText('12°C')).toBeInTheDocument();
    expect(screen.getByText('Bewolkt')).toBeInTheDocument();
  });

  it.each([
    ['online', 'display.connection.online'],
    ['ha-down', 'display.connection.haDown'],
    ['beacon-down', 'display.connection.beaconDown'],
    ['offline', 'display.connection.offline'],
  ] as const)('names the %s connection state', (state, key) => {
    renderDisplay({ connection: state });

    expect(screen.getByRole('status')).toHaveTextContent(NL.t(key));
  });

  it('navigates from the large touch targets', () => {
    const { onNavigate } = renderDisplay();

    fireEvent.click(screen.getByRole('button', { name: NL.t('nav.chores') }));
    expect(onNavigate).toHaveBeenCalledWith('chores');

    fireEvent.click(screen.getByRole('button', { name: NL.t('nav.grocery') }));
    expect(onNavigate).toHaveBeenCalledWith('grocery');
  });

  it('hides panels that are switched off', () => {
    renderDisplay({ panels: { agenda: false, family: false } });

    expect(screen.queryByText('School')).toBeNull();
    expect(screen.queryByRole('region', { name: NL.t('display.family') })).toBeNull();
    // The remaining panel stays.
    expect(screen.getByRole('region', { name: NL.t('display.chores') })).toBeInTheDocument();
  });

  it('renders without navigation when no handler is given', () => {
    renderDisplay({ onNavigate: undefined });

    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
