/**
 * The member add/edit form: name, role, avatar, photo, colour and PIN.
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
import type { MemberForm, MemberFormMode } from './types';

export interface MemberFormViewProps {
  form: MemberForm;
  mode: Exclude<MemberFormMode, 'list'>;
  photoError: string | null;
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
      <div className="settings-row">
        <div>
          <div className="settings-row-label">{t('settings.family.localChoresManMember')}</div>
          <div className="settings-row-sublabel">
            {t('settings.family.localChoresManMemberHelp')}
          </div>
        </div>
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
