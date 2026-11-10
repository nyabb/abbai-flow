/**
 * Today's agenda for the wall display.
 *
 * Read-only on purpose: a wall screen is easy to bump, so events are a list to
 * read, not a surface to edit. All-day entries come first, then the timed ones
 * in start order.
 */
import { format } from 'date-fns';
import { useTranslation } from '../../i18n';
import type { CalendarEvent } from '../../types';

export interface DisplayAgendaProps {
  events: CalendarEvent[];
  /** The day being shown — normally "today". */
  day: Date;
  timeFormat: '12h' | '24h';
  /** How many entries to show before the panel scrolls. */
  limit?: number;
  now: Date;
}

function timeLabel(event: CalendarEvent, timeFormat: '12h' | '24h'): string {
  if (event.allDay) return '';
  return format(new Date(event.start), timeFormat === '12h' ? 'h:mm a' : 'HH:mm');
}

export function DisplayAgenda({ events, day, timeFormat, limit = 8, now }: DisplayAgendaProps) {
  const { t } = useTranslation();
  const dayKey = format(day, 'yyyy-MM-dd');
  const isToday = format(now, 'yyyy-MM-dd') === dayKey;

  const todayEvents = events
    .filter((event) => format(new Date(event.start), 'yyyy-MM-dd') === dayKey)
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });

  const shown = todayEvents.slice(0, limit);

  return (
    <section className="display-panel display-panel--agenda" aria-labelledby="display-agenda-title">
      <h2 className="display-panel-title" id="display-agenda-title">
        {isToday ? t('display.today') : format(day, 'EEEE d MMMM')}
      </h2>

      {shown.length === 0 ? (
        <p className="display-empty">{t('display.nothingScheduled')}</p>
      ) : (
        <ul className="display-agenda-list">
          {shown.map((event) => {
            const past = !event.allDay && new Date(event.end).getTime() < now.getTime();
            return (
              <li key={event.id} className={`display-agenda-item ${past ? 'is-past' : ''}`}>
                <span
                  className="display-agenda-dot"
                  style={{ backgroundColor: event.color }}
                  aria-hidden="true"
                />
                <span className="display-agenda-time">
                  {event.allDay ? t('display.allDay') : timeLabel(event, timeFormat)}
                </span>
                <span className="display-agenda-title">{event.title}</span>
                {event.location && (
                  <span className="display-agenda-location">{event.location}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {todayEvents.length > shown.length && (
        <p className="display-more">
          {t('display.moreEvents', { count: todayEvents.length - shown.length })}
        </p>
      )}
    </section>
  );
}
