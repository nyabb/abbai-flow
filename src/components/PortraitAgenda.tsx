import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  addDays,
  addWeeks,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, Plus } from 'lucide-react';
import type { CalendarEvent } from '../types';
import { useTranslation } from '../i18n';
import { LoadingPlaceholder } from './LoadingPlaceholder';

interface PortraitAgendaProps {
  events: CalendarEvent[];
  hiddenCalendars: Set<string>;
  eventsLoading?: boolean;
  weekStartsOn: 0 | 1;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (date: string, hour: number) => void;
  onVisibleWeekChange?: (weekStart: Date) => void;
}

/** A vertically grouped agenda for a tall, full-screen portrait display. */
export function PortraitAgenda({
  events,
  hiddenCalendars,
  eventsLoading = false,
  weekStartsOn,
  onEventClick,
  onSlotClick,
  onVisibleWeekChange,
}: PortraitAgendaProps) {
  const { t, dateLocale } = useTranslation();
  const today = new Date();
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(
    () => startOfWeek(addWeeks(today, weekOffset), { weekStartsOn }),
    // The week changes only when the user moves the agenda or changes locale settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekOffset, weekStartsOn],
  );

  useEffect(() => {
    onVisibleWeekChange?.(weekStart);
  }, [onVisibleWeekChange, weekStart]);

  const visibleEvents = useMemo(
    () => events.filter((event) => !hiddenCalendars.has(event.calendarId)),
    [events, hiddenCalendars],
  );
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const eventsForDay = (day: Date) => {
    const dayStart = startOfDay(day);
    const nextDay = addDays(dayStart, 1);
    return visibleEvents
      .filter((event) => {
        const start = parseISO(event.start);
        const end = parseISO(event.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
        return start < nextDay && end > dayStart;
      })
      .sort((left, right) => {
        if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
        return parseISO(left.start).getTime() - parseISO(right.start).getTime();
      });
  };

  const rangeEnd = addDays(weekStart, 6);
  const weekLabel = `${format(weekStart, 'd MMM', { locale: dateLocale })} – ${format(rangeEnd, 'd MMM', { locale: dateLocale })}`;

  return (
    <section className="portrait-agenda" aria-label={t('nav.calendar')}>
      <div className="portrait-agenda-week">
        <button
          type="button"
          className="portrait-agenda-week-arrow"
          onClick={() => setWeekOffset((offset) => offset - 1)}
          aria-label={t('weekCalendar.previousWeek')}
          title={t('weekCalendar.previousWeek')}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <div className="portrait-agenda-week-label" aria-live="polite">{weekLabel}</div>
        <button
          type="button"
          className="portrait-agenda-today"
          onClick={() => setWeekOffset(0)}
          disabled={weekOffset === 0}
        >
          {t('common.today')}
        </button>
        <button
          type="button"
          className="portrait-agenda-week-arrow"
          onClick={() => setWeekOffset((offset) => offset + 1)}
          aria-label={t('weekCalendar.nextWeek')}
          title={t('weekCalendar.nextWeek')}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>

      <div className="portrait-agenda-scroll">
        {eventsLoading ? (
          <LoadingPlaceholder
            label={t('app.connecting')}
            lines={5}
            className="loading-placeholder--list portrait-agenda-loading"
          />
        ) : days.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const dayEvents = eventsForDay(day);
          const todayGroup = isSameDay(day, today);
          return (
            <section
              className={`portrait-agenda-day${todayGroup ? ' is-today' : ''}`}
              key={key}
              aria-labelledby={`portrait-agenda-day-${key}`}
            >
              <header className="portrait-agenda-day-header">
                <div className="portrait-agenda-date-block" aria-hidden="true">
                  <strong>{format(day, 'd', { locale: dateLocale })}</strong>
                  <span>{format(day, 'EEE', { locale: dateLocale })}</span>
                </div>
                <div className="portrait-agenda-day-copy">
                  <h2 id={`portrait-agenda-day-${key}`}>
                    {format(day, 'EEEE, d MMMM', { locale: dateLocale })}
                  </h2>
                  {todayGroup && <span className="portrait-agenda-today-label">{t('common.today')}</span>}
                </div>
                <span className="portrait-agenda-count" aria-label={`${dayEvents.length}`}>
                  {dayEvents.length}
                </span>
                <button
                  type="button"
                  className="portrait-agenda-add"
                  onClick={() => onSlotClick(key, 9)}
                  aria-label={t('weekCalendar.addEventOnAt', {
                    day: format(day, 'EEEE', { locale: dateLocale }),
                    time: '9:00 AM',
                  })}
                  title={t('weekCalendar.addEventOnAt', {
                    day: format(day, 'EEEE', { locale: dateLocale }),
                    time: '9:00 AM',
                  })}
                >
                  <Plus aria-hidden="true" />
                </button>
              </header>

              {dayEvents.length === 0 ? (
                <div className="portrait-agenda-empty">{t('calendarSidebar.nothingScheduled')}</div>
              ) : (
                <div className="portrait-agenda-events">
                  {dayEvents.map((event) => {
                    const start = parseISO(event.start);
                    const end = parseISO(event.end);
                    const EventIcon = event.allDay ? CalendarDays : Clock3;
                    const timeLabel = event.allDay
                      ? t('common.allDay')
                      : `${format(start, 'p', { locale: dateLocale })} – ${format(end, 'p', { locale: dateLocale })}`;
                    return (
                      <button
                        className="portrait-agenda-event"
                        key={`${event.id}-${key}`}
                        type="button"
                        onClick={() => onEventClick(event)}
                        style={{ '--agenda-event-color': event.color } as CSSProperties}
                      >
                        <span className="portrait-agenda-event-icon">
                          <EventIcon aria-hidden="true" />
                        </span>
                        <span className="portrait-agenda-event-copy">
                          <strong>{event.title}</strong>
                          <span className="portrait-agenda-event-meta">
                            <span>{timeLabel}</span>
                            {event.location && (
                              <span className="portrait-agenda-location">
                                <MapPin aria-hidden="true" />
                                {event.location}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="portrait-agenda-event-chevron" aria-hidden="true">
                          <ChevronRight />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
