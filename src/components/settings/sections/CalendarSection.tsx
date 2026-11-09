/**
 * Calendar settings: per-calendar visibility and colour overrides plus the
 * defaults used when creating new events.
 */
import { useState } from 'react';
import { CALENDAR_COLOR_PRESETS, resolveCalendarColor } from '../../../types';
import type { FamilyMember } from '../../../types/family';
import { Segment, Toggle } from '../controls';
import type { SettingsSectionContext } from './context';

export interface CalendarInfoSummary {
  id: string;
  name: string;
  color?: string;
}

export interface CalendarSectionProps extends SettingsSectionContext {
  calendars: CalendarInfoSummary[];
  members: FamilyMember[];
}

export function CalendarSection({
  settings,
  onUpdateSettings,
  t,
  calendars,
  members,
}: CalendarSectionProps) {
  const [colorEditId, setColorEditId] = useState<string | null>(null);

  return (
    <>
      <h2 className="settings-section-title">{t('settings.calendar.title')}</h2>
      <p className="settings-section-desc">{t('settings.calendar.desc')}</p>

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.calendar.connectedCalendarsTitle')}</div>
        {calendars.length === 0 ? (
          <div className="settings-row">
            <div className="settings-row-label" style={{ color: 'var(--text-secondary)' }}>
              {t('settings.calendar.noCalendars')}
            </div>
          </div>
        ) : (
          calendars.map((cal, index) => {
            const isHidden = settings.permanentlyHiddenCalendars.includes(cal.id);
            const customColor = settings.calendarColors[cal.id] || '';
            const resolvedColor = resolveCalendarColor(cal.id, index, {
              calendarColors: settings.calendarColors,
              members,
              defaultColor: cal.color,
            });
            const open = colorEditId === cal.id;

            const setColor = (value: string) => {
              onUpdateSettings({
                calendarColors: { ...settings.calendarColors, [cal.id]: value },
              });
            };
            const resetColor = () => {
              const next = { ...settings.calendarColors };
              delete next[cal.id];
              onUpdateSettings({ calendarColors: next });
            };

            return (
              <div key={cal.id} className="settings-calendar-row">
                <div className="settings-row">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <button
                      type="button"
                      className="settings-calendar-color-swatch"
                      style={{ backgroundColor: resolvedColor }}
                      onClick={() => setColorEditId(open ? null : cal.id)}
                      title={t('settings.calendar.editColor')}
                      aria-label={t('settings.calendar.editColorFor', { name: cal.name })}
                      aria-expanded={open}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div className="settings-row-label">{cal.name}</div>
                      <div className="settings-row-sublabel">{cal.id}</div>
                    </div>
                  </div>
                  <Toggle
                    checked={!isHidden}
                    onChange={(visible) => {
                      const hidden = settings.permanentlyHiddenCalendars.filter(
                        (id) => id !== cal.id,
                      );
                      if (!visible) hidden.push(cal.id);
                      onUpdateSettings({ permanentlyHiddenCalendars: hidden });
                    }}
                  />
                </div>
                {open && (
                  <div className="settings-color-editor">
                    <div className="settings-color-grid">
                      {CALENDAR_COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className={`settings-color-circle ${customColor === preset ? 'settings-color-circle--selected' : ''}`}
                          style={{ backgroundColor: preset }}
                          onClick={() => setColor(preset)}
                          aria-label={t('settings.calendar.setColorTo', {
                            name: cal.name,
                            color: preset,
                          })}
                        />
                      ))}
                    </div>
                    <div className="settings-color-editor-custom">
                      <label className="settings-color-custom">
                        <input
                          type="color"
                          value={customColor || resolvedColor}
                          onChange={(e) => setColor(e.target.value)}
                          aria-label={t('settings.calendar.chooseCustomColorFor', {
                            name: cal.name,
                          })}
                        />
                        <span>{t('common.custom')}</span>
                      </label>
                      <button
                        type="button"
                        className="settings-btn"
                        onClick={resetColor}
                        disabled={!customColor}
                      >
                        {t('settings.calendar.resetToAuto')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-label">{t('settings.calendar.defaultCalendarLabel')}</div>
          <select
            className="settings-select"
            value={settings.defaultCalendar}
            onChange={(e) => onUpdateSettings({ defaultCalendar: e.target.value })}
          >
            <option value="">{t('common.selectEllipsis')}</option>
            {calendars.map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.name}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">
            {t('settings.calendar.defaultEventDurationLabel')}
          </div>
          <Segment
            value={String(settings.defaultEventDuration)}
            options={[
              { value: '30', label: t('settings.calendar.min30') },
              { value: '60', label: t('settings.calendar.hr1') },
              { value: '120', label: t('settings.calendar.hr2') },
            ]}
            onChange={(v) => onUpdateSettings({ defaultEventDuration: Number(v) as 30 | 60 | 120 })}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-label">{t('settings.calendar.notificationTimingLabel')}</div>
          <Segment
            value={String(settings.notificationMinutes)}
            options={[
              { value: '5', label: t('settings.calendar.min5') },
              { value: '10', label: t('settings.calendar.min10') },
              { value: '15', label: t('settings.calendar.min15') },
              { value: '30', label: t('settings.calendar.min30') },
            ]}
            onChange={(v) =>
              onUpdateSettings({ notificationMinutes: Number(v) as 5 | 10 | 15 | 30 })
            }
          />
        </div>
      </div>
    </>
  );
}
