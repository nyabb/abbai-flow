/**
 * Today's chores with completion state, grouped by the member they belong to.
 *
 * Read-only: the wall display is for glancing at, and a mis-tap that approves a
 * child's chore is hard to undo. Actions stay in the chores screen where there
 * is a confirmation path.
 */
import { useTranslation } from '../../i18n';
import { isChoreDone, memberColorVars } from '../choreops/chore-actions';
import { MemberAvatar } from '../MemberAvatar';
import type { FamilyMember } from '../../types/family';
import type { ChoreOpsChore } from '../../types/choreops';
import { resolveMemberForUser } from '../../api/choreops/members';

export interface DisplayChoresProps {
  chores: ChoreOpsChore[];
  members: FamilyMember[];
  /** Show at most this many per member before"+N more". */
  perMemberLimit?: number;
}

interface MemberGroup {
  id: string;
  name: string;
  member: FamilyMember | null;
  chores: ChoreOpsChore[];
}

export function DisplayChores({ chores, members, perMemberLimit = 4 }: DisplayChoresProps) {
  const { t } = useTranslation();

  const groups = new Map<string, MemberGroup>();
  for (const chore of chores) {
    const names = chore.assignedUserNames?.length
      ? chore.assignedUserNames
      : chore.assignee
        ? [chore.assignee]
        : [];

    if (names.length === 0) {
      const key = '__unassigned';
      const group = groups.get(key) ?? {
        id: key,
        name: t('display.unassigned'),
        member: null,
        chores: [],
      };
      group.chores.push(chore);
      groups.set(key, group);
      continue;
    }

    for (const name of names) {
      const member = resolveMemberForUser(name, members) ?? null;
      const key = member?.id ?? name;
      const group = groups.get(key) ?? {
        id: key,
        name: member?.name ?? name,
        member,
        chores: [],
      };
      group.chores.push(chore);
      groups.set(key, group);
    }
  }

  const ordered = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  const done = chores.filter((chore) => isChoreDone(chore.status)).length;

  return (
    <section className="display-panel display-panel--chores" aria-labelledby="display-chores-title">
      <div className="display-panel-heading">
        <h2 className="display-panel-title" id="display-chores-title">
          {t('display.chores')}
        </h2>
        <span className="display-count">
          {t('display.choresDone', { done, total: chores.length })}
        </span>
      </div>

      {chores.length === 0 ? (
        <p className="display-empty">{t('display.noChores')}</p>
      ) : (
        <ul className="display-chore-groups">
          {ordered.map((group) => {
            const shown = group.chores.slice(0, perMemberLimit);
            const hidden = group.chores.length - shown.length;
            return (
              <li key={group.id} className="display-chore-group" style={memberColorVars(group.member)}>
                <div className="display-chore-member">
                  {group.member ? (
                    <MemberAvatar member={group.member} size={28} />
                  ) : (
                    <span className="display-chore-member-dot" aria-hidden="true" />
                  )}
                  <span className="display-chore-member-name">{group.name}</span>
                </div>
                <ul className="display-chore-list">
                  {shown.map((chore) => {
                    const complete = isChoreDone(chore.status);
                    return (
                      <li
                        key={`${group.id}-${chore.id}`}
                        className={`display-chore ${complete ? 'is-done' : ''}`}
                      >
                        <span className="display-chore-icon" aria-hidden="true">
                          {chore.icon ?? '•'}
                        </span>
                        <span className="display-chore-name">{chore.name}</span>
                        <span className="display-chore-state">
                          {complete ? t('display.done') : t('display.open')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {hidden > 0 && (
                  <p className="display-more">{t('display.moreChores', { count: hidden })}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
