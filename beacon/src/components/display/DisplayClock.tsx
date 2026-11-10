/**
 * The big clock in the display band.
 *
 * It owns its own one-second ticker so that the *only* thing re-rendering every
 * second is this component. Ticking in `DisplayView` instead re-rendered the
 * agenda, chores and family panels 86 400 times a day on a Pi that is meant to
 * run for weeks.
 */
import { format } from 'date-fns';
import { useTranslation } from '../../i18n';
import { useNow } from './useNow';

export interface DisplayClockProps {
  timeFormat: '12h' | '24h';
}

export function DisplayClock({ timeFormat }: DisplayClockProps) {
  const { dateLocale } = useTranslation();
  const now = useNow(1000);

  const time = format(now, timeFormat === '12h' ? 'h:mm' : 'HH:mm');
  const meridiem = timeFormat === '12h' ? format(now, 'a') : '';

  return (
    <div className="display-clock">
      <span className="display-clock-time">
        {time}
        {meridiem && <span className="display-clock-meridiem">{meridiem}</span>}
      </span>
      <span className="display-clock-date">{format(now, 'EEEE d MMMM', { locale: dateLocale })}</span>
    </div>
  );
}
