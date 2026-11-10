/**
 * Family overview for the wall display: one tile per member with their avatar,
 * colour and today's ChoreOps numbers.
 *
 * The numbers come straight from ChoreOps' per-user sensors, so a member with no
 * ChoreOps account (a parent, usually) is still shown — just without a count.
 */
import { useTranslation } from '../../i18n';
import { MemberAvatar } from '../MemberAvatar';
import type { FamilyMember } from '../../types/family';
import type { ChoreOpsUser } from '../../types/choreops';

export interface DisplayFamilyProps {
  members: FamilyMember[];
  users: ChoreOpsUser[];
}

export function DisplayFamily({ members, users }: DisplayFamilyProps) {
  const { t } = useTranslation();

  const userFor = (member: FamilyMember): ChoreOpsUser | undefined => {
    const link = (member.choreops_user ?? member.name).trim().toLowerCase();
    return users.find((user) => user.name.trim().toLowerCase() === link);
  };

  return (
    <section className="display-panel display-panel--family" aria-labelledby="display-family-title">
      <h2 className="display-panel-title" id="display-family-title">
        {t('display.family')}
      </h2>

      {members.length === 0 ? (
        <p className="display-empty">{t('display.noMembers')}</p>
      ) : (
        <ul className="display-family-list">
          {members.map((member) => {
            const user = userFor(member);
            const due = user?.dueToday ?? 0;
            const done = user?.completedToday ?? 0;
            return (
              <li key={member.id} className="display-family-member">
                <span
                  className="display-family-avatar"
                  style={{ borderColor: member.color, backgroundColor: `${member.color}22` }}
                >
                  <MemberAvatar member={member} size={40} />
                </span>
                <span className="display-family-name">{member.name}</span>
                {user ? (
                  <span className="display-family-stats">
                    <span className="display-family-stat">
                      {t('display.points', { points: user.points })}
                    </span>
                    <span className="display-family-stat">
                      {t('display.choresToday', { done, due: Math.max(due, done) })}
                    </span>
                  </span>
                ) : (
                  <span className="display-family-stats">
                    <span className="display-family-stat display-family-stat--muted">
                      {t('display.notLinked')}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
