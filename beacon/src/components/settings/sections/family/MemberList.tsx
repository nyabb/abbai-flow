/**
 * The family member list: avatar, name and role per member, with routine,
 * edit and delete actions. Delete is two-step â€” the confirmation timer lives
 * in the parent, which passes the pending id back in.
 */
import { ListChecks, Pencil, Trash2 } from 'lucide-react';
import type { I18nValue } from '../../../../i18n';
import type { FamilyMember } from '../../../../types/family';
import { MemberAvatar } from '../../../MemberAvatar';

export interface MemberListProps {
  members: FamilyMember[];
  /** Id of the member whose delete was armed, if any. */
  confirmDelete: string | null;
  t: I18nValue['t'];
  onOpenRoutines: (member: FamilyMember) => void;
  onEdit: (member: FamilyMember) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

export function MemberList({
  members,
  confirmDelete,
  t,
  onOpenRoutines,
  onEdit,
  onDelete,
  onAdd,
}: MemberListProps) {
  return (    <div className="settings-group">
      <div className="settings-fm-list">
        {members.length === 0 && (
          <div className="settings-fm-empty">{t('settings.family.empty')}</div>
        )}
        {members.map((member) => (
          <div key={member.id} className="settings-fm-card">
            <div
              className="settings-fm-avatar"
              style={{
                backgroundColor: member.color + '22',
                border: `2px solid ${member.color}`,
              }}
            >
              <MemberAvatar member={member} />
            </div>
            <div className="settings-fm-info">
              <div className="settings-fm-name">{member.name}</div>
              <div className="settings-fm-role">
                {member.role === 'parent'
                  ? t('settings.family.parent')
                  : t('settings.family.child')}
              </div>
            </div>
            <div className="settings-fm-actions">
              <button
                type="button"
                className="settings-fm-btn"
                onClick={() => onOpenRoutines(member)}
                aria-label={t('settings.family.routinesFor', { name: member.name })}
              >
                <ListChecks size={16} />
              </button>
              <button
                type="button"
                className="settings-fm-btn"
                onClick={() => onEdit(member)}
                aria-label={t('settings.family.editMember', { name: member.name })}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className={`settings-fm-btn settings-fm-btn--danger`}
                onClick={() => onDelete(member.id)}
                aria-label={t('settings.family.deleteMember', { name: member.name })}
              >
                {confirmDelete === member.id ? (
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#ef4444' }}>
                    {t('common.sure')}
                  </span>
                ) : (
                  <Trash2 size={16} />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: '8px 20px 16px' }}>
        <button
          type="button"
          className="settings-btn settings-btn--primary"
          onClick={onAdd}
        >
          {t('settings.family.addMember')}
        </button>
      </div>
    </div>  );
}