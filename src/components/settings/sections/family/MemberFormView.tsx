/**
 * The member add/edit form: name, role, avatar, photo, linked HA person,
 * colour, PIN and calendars.
 *
 * Pure presentation â€” the form value and every mutation live in
 * `FamilySection`, which owns the state.
 */
import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { I18nValue } from '../../../../i18n';
import { AVATAR_CATEGORIES, MEMBER_COLORS, normalizePin } from '../../../../types/family';
import { resolveMemberPhoto } from '../../../../utils/member-photo';
import { Segment } from '../../controls';
import type { FamilyCalendarSummary } from '../FamilySection';
import type { MemberForm, MemberFormMode, PersonOption } from './types';

export interface MemberFormViewProps {
  form: MemberForm;
  mode: Exclude<MemberFormMode, 'list'>;
  photoError: string | null;
  /** A photo already published on the linked HA person, if any. */
  linkedPhoto: string | null;
  peopleOptions: PersonOption[];
  isLinkedElsewhere: (personName: string) => boolean;
  calendars: FamilyCalendarSummary[];
  t: I18nValue['t'];
  onChange: Dispatch<SetStateAction<MemberForm>>;
  onPhotoUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function MemberFormView({
  form,
  mode,
  photoError,
  linkedPhoto,
  peopleOptions,
  isLinkedElsewhere,
  calendars,
  t,
  onChange,
  onPhotoUpload,
  onCancel,
  onSave,
}: MemberFormViewProps) {
  return (
    <div className="settings-group">
      <div style={{ padding: '12px 20px 4px' }}>
        <button
          type="button"
          className="settings-btn"
          onClick={onCancel}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12 }}
        >
          <ChevronLeft size={16} /> {t('common.back')}
        </button>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">{t('settings.family.nameLabel')}</div>
        <input
          type="text"
          className="settings-input"
          value={form.name}
          onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
          placeholder={t('settings.family.namePlaceholder')}
          autoFocus
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">{t('settings.family.roleLabel')}</div>
        <Segment
          value={form.role}
          options={[
            { value: 'parent', label: t('settings.family.parent') },
            { value: 'child', label: t('settings.family.child') },
          ]}
          onChange={(v) => onChange((f) => ({ ...f, role: v }))}
        />
      </div>
      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div className="settings-row-label" style={{ paddingTop: 4 }}>
          {t('settings.family.avatarLabel')}
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            maxWidth: 300,
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {AVATAR_CATEGORIES.map((cat) => (
            <div key={cat.labelKey} style={{ width: '100%' }}>
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  color: 'var(--text-muted)',
                  margin: '4px 0 2px',
                }}
              >
                {t(cat.labelKey)}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {cat.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      border:
                        form.avatar === emoji
                          ? '2px solid var(--accent)'
                          : '1px solid var(--border)',
                      background: form.avatar === emoji ? 'var(--bg-today)' : 'none',
                      fontSize: '1.2rem',
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                    }}
                    onClick={() => onChange((f) => ({ ...f, avatar: emoji }))}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="settings-row-label">{t('settings.family.photoLabel')}</div>
          <div className="settings-row-sublabel">{t('settings.family.photoHint')}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {form.photo && (
            <img
              className="member-photo"
              src={resolveMemberPhoto(form.photo)}
              alt=""
              style={{
                width: 48,
                height: 48,
                border: `2px solid ${form.color}`,
                background: form.color + '22',
              }}
            />
          )}
          <label className="settings-btn" style={{ cursor: 'pointer', margin: 0 }}>
            {t('settings.family.photoUpload')}
            <input
              type="file"
              accept="image/*"
              onChange={onPhotoUpload}
              style={{ display: 'none' }}
            />
          </label>
          {linkedPhoto && form.photo !== linkedPhoto && (
            <button
              type="button"
              className="settings-btn"
              onClick={() => onChange((current) => ({ ...current, photo: linkedPhoto }))}
            >
              {t('settings.family.photoFromHa')}
            </button>
          )}
          {form.photo && (
            <button
              type="button"
              className="settings-btn"
              onClick={() => onChange((current) => ({ ...current, photo: '' }))}
            >
              {t('settings.family.photoRemove')}
            </button>
          )}
        </div>
      </div>
      {photoError && (
        <div className="settings-row">
          <span style={{ color: 'var(--color-error)', fontSize: '0.85rem' }}>{photoError}</span>
        </div>
      )}
      {/* Always rendered: when the picker vanished entirely it looked
          like the feature was missing rather than "HA returned nobody". */}
      <div className="settings-row">
        <div className="settings-row-label">{t('settings.family.haMembersLabel')}</div>
        {peopleOptions.length > 0 ? (
          <select
            value={form.choreops_user}
            onChange={(e) => {
              const value = e.target.value;
              onChange((f) => {
                // Keep a hand-written name; adopt the HA name when the
                // field is blank or was auto-filled from a previous pick.
                const autoNamed = !f.name.trim() || f.name === f.choreops_user;
                return {
                  ...f,
                  choreops_user: value,
                  name: value && autoNamed ? value : f.name,
                };
              });
            }}
            className="settings-select"
          >
            <option value="">Not linked</option>
            {peopleOptions.map((person) => {
              const added = isLinkedElsewhere(person.name);
              return (
                <option key={person.name} value={person.name} disabled={added}>
                  {person.name}
                  {person.hasChoreOps ? ' · ChoreOps' : ''}
                  {added ? ' (already added)' : ''}
                </option>
              );
            })}
          </select>
        ) : (
          <span className="settings-row-sublabel" style={{ maxWidth: 320 }}>
            {t('settings.family.haMembersEmpty')}
          </span>
        )}
      </div>
      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div className="settings-row-label" style={{ paddingTop: 4 }}>
          {t('settings.family.colorLabel')}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {MEMBER_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`settings-color-circle ${form.color === color ? 'settings-color-circle--selected' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => onChange((f) => ({ ...f, color }))}
              aria-label={t('settings.family.selectColor', { color })}
            />
          ))}
        </div>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t('settings.family.pinLabel')}</div>
          <div className="settings-row-sublabel">{t('settings.family.pinSublabel')}</div>
        </div>
        <input
          type="password"
          className="settings-input"
          style={{ width: 120 }}
          value={form.pin}
          onChange={(e) => {
            const val = normalizePin(e.target.value);
            onChange((f) => ({ ...f, pin: val }));
          }}
          placeholder="****"
          inputMode="numeric"
          maxLength={6}
        />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t('settings.family.calendarLabel')}</div>
          <div className="settings-row-sublabel">{t('settings.family.calendarSublabel')}</div>
        </div>
        <select
          className="settings-select"
          value={form.calendar_entity}
          onChange={(e) => onChange((f) => ({ ...f, calendar_entity: e.target.value }))}
        >
          <option value="">{t('common.none')}</option>
          {calendars.map((cal) => (
            <option key={cal.id} value={cal.id}>
              {cal.name}
            </option>
          ))}
        </select>
      </div>
      <div
        className="settings-row"
        style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
      >
        <div>
          <div className="settings-row-label">{t('settings.family.additionalCalendarsLabel')}</div>
          <div className="settings-row-sublabel">
            {t('settings.family.additionalCalendarsSublabel')}
          </div>
        </div>
        {form.additional_calendar_entities.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {form.additional_calendar_entities.map((entityId) => {
              const cal = calendars.find((c) => c.id === entityId);
              return (
                <div
                  key={entityId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span className="settings-row-sublabel">{cal?.name ?? entityId}</span>
                  <button
                    type="button"
                    className="settings-btn"
                    onClick={() =>
                      onChange((f) => ({
                        ...f,
                        additional_calendar_entities: f.additional_calendar_entities.filter(
                          (id) => id !== entityId,
                        ),
                      }))
                    }
                  >
                    {t('common.remove')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <select
          className="settings-select"
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            onChange((f) =>
              f.additional_calendar_entities.includes(id)
                ? f
                : {
                    ...f,
                    additional_calendar_entities: [...f.additional_calendar_entities, id],
                  },
            );
          }}
        >
          <option value="">{t('settings.family.addAnotherCalendar')}</option>
          {calendars
            .filter(
              (cal) =>
                cal.id !== form.calendar_entity &&
                !form.additional_calendar_entities.includes(cal.id),
            )
            .map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.name}
              </option>
            ))}
        </select>
      </div>
      <div
        style={{
          padding: '12px 20px 16px',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        <button type="button" className="settings-btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="settings-btn settings-btn--primary"
          onClick={onSave}
          disabled={!form.name.trim()}
        >
          {mode === 'edit' ? t('settings.family.saveChanges') : t('settings.family.addMemberBtn')}
        </button>
      </div>
    </div>
  );
}
