/**
 * Qudoo-style chore and reward cards.
 *
 * The layout mirrors the Qudoo family planner: a tinted medallion with the
 * chore's icon, the name centred under it, and a split pill at the bottom
 * where the left half is the action and the right half is the reward.
 *
 * Every action comes from ChoreOps' own `button.*` entities (discovered at
 * runtime), so nothing here assumes entity ids or attribute names.
 */
import type { CSSProperties } from 'react';
import { useTranslation } from '../../i18n';
import type { FamilyMember } from '../../types/family';
import type { ChoreOpsChore, ChoreOpsReward, ChoreOpsUser } from '../../types/choreops';

const DONE_STATUS = /^(approved|completed|done)/i;

/** ChoreOps states that mean "the child is done, a parent must sign off". */
const AWAITING_REVIEW_STATUS = /(claim|pending|review|progress|submit)/i;

/** ChoreOps `icon` may be an emoji or an icon key; only emoji are portable. */
function choreEmoji(icon: string | null): string {
  return icon && !icon.includes(':') ? icon : '\u{2705}';
}

/** Expose the member colour to CSS without allocating a new object per render. */
export function memberColorVars(member: FamilyMember | null): CSSProperties {
  return member ? ({ '--member-color': member.color } as CSSProperties) : ({} as CSSProperties);
}

interface PrimaryAction {
  kind: 'claim' | 'approve';
  entityId: string;
}

/**
 * Pick the single most useful action for a chore.
 *
 * ChoreOps publishes claim *and* approve buttons for every chore/user pair
 * regardless of state, so the buttons alone say nothing about what is
 * actionable. The status does: a chore waiting for review gets Approve, an
 * untouched one gets Claim. Picking approve just because the button exists
 * would have shown "Approve" to the child who still has to do the chore.
 */
export function chorePrimaryAction(chore: ChoreOpsChore): PrimaryAction | null {
  if (DONE_STATUS.test(chore.status)) return null;

  const claim = chore.actions.claim;
  const approve = chore.actions.approve;
  const awaitingReview = AWAITING_REVIEW_STATUS.test(chore.status);

  if (awaitingReview && approve) return { kind: 'approve', entityId: approve };
  if (claim) return { kind: 'claim', entityId: claim };
  if (approve) return { kind: 'approve', entityId: approve };
  return null;
}

export type ChoreActionKind = 'claim' | 'approve' | 'disapprove';

export interface ChoreTaskCardProps {
  chore: ChoreOpsChore;
  member: FamilyMember | null;
  /** This card's action is in flight. */
  pending: boolean;
  /** Another action is in flight, so this card must not fire. */
  blocked: boolean;
  /** False when no parent PIN is configured — approvals stay locked. */
  approvalAllowed: boolean;
  onAction: (key: string, entityId: string, kind: ChoreActionKind) => void;
  /** Offered on chores nobody is assigned to (they have no claim button). */
  onClaimUnassigned?: (chore: ChoreOpsChore) => void;
}

export function ChoreTaskCard({
  chore,
  member,
  pending,
  blocked,
  approvalAllowed,
  onAction,
  onClaimUnassigned,
}: ChoreTaskCardProps) {
  const { t } = useTranslation();
  const done = DONE_STATUS.test(chore.status);
  const primary = chorePrimaryAction(chore);
  const declineEid = chore.actions.disapprove;
  // A child must not be able to sign off their own chore on a shared screen.
  const approveLocked = !approvalAllowed || blocked || pending;
  const unassigned = !chore.assignee;

  return (
    <article
      className={`choreops-card ${done ? 'choreops-card--done' : ''}`}
      style={memberColorVars(member)}
    >
      <div className="choreops-card-top">
        <span className={`choreops-pill ${done ? 'choreops-pill--done' : ''}`}>{chore.status}</span>
      </div>

      <span className="choreops-card-icon" aria-hidden="true">
        {choreEmoji(chore.icon)}
      </span>

      <h3 className="choreops-card-title">{chore.name}</h3>

      {primary?.kind === 'claim' && (
        <button
          type="button"
          className="choreops-action"
          disabled={blocked || pending}
          onClick={() => onAction(`${chore.id}:claim`, primary.entityId, 'claim')}
        >
          <span className="choreops-action-main">{pending ? '\u2026' : t('chores.claim')}</span>
          <span className="choreops-action-reward">
            <span aria-hidden="true">{'\u{1F3C6}'}</span>
            {chore.points !== null && chore.points > 0 ? chore.points : null}
          </span>
        </button>
      )}

      {/* Claimed: the child's part is done, so nothing here is theirs to press.
          Signing off is a parent action and needs the PIN. */}
      {primary?.kind === 'approve' && (
        <>
          <p className="choreops-card-waiting">{t('chores.awaitingApproval')}</p>
          <button
            type="button"
            className="choreops-action"
            disabled={approveLocked}
            onClick={() => onAction(`${chore.id}:approve`, primary.entityId, 'approve')}
          >
            <span className="choreops-action-main">{pending ? '\u2026' : t('chores.approve')}</span>
            <span className="choreops-action-reward" aria-hidden="true">
              {'\u{1F512}'}
            </span>
          </button>
          {declineEid && (
            <button
              type="button"
              className="choreops-secondary"
              disabled={approveLocked}
              onClick={() => onAction(`${chore.id}:decline`, declineEid, 'disapprove')}
            >
              {t('chores.decline')}
            </button>
          )}
        </>
      )}

      {!primary && done && (
        <button type="button" className="choreops-action choreops-action--done" disabled>
          <span className="choreops-action-main">{t('common.done')}</span>
          <span className="choreops-action-reward" aria-hidden="true">
            {'\u2713'}
          </span>
        </button>
      )}

      {/* Unassigned: ChoreOps publishes no claim button, but the service call can
          assign and claim in one go — so anyone can take this chore on. */}
      {!primary && !done && unassigned && onClaimUnassigned && (
        <button
          type="button"
          className="choreops-action"
          disabled={blocked || pending}
          onClick={() => onClaimUnassigned(chore)}
        >
          <span className="choreops-action-main">{pending ? '\u2026' : t('chores.claim')}</span>
          <span className="choreops-action-reward" aria-hidden="true">
            {'\u{1F464}'}
          </span>
        </button>
      )}

      {!primary && !done && unassigned && !onClaimUnassigned && (
        <p className="choreops-card-hint">{t('chores.assignToClaim')}</p>
      )}
    </article>
  );
}

export interface RewardGoalCardProps {
  reward: ChoreOpsReward;
  /** ChoreOps user who claimed (or is entitled to) this reward. */
  owner: ChoreOpsUser | null;
  member: FamilyMember | null;
  pending: boolean;
  blocked: boolean;
  /** False when no parent PIN is configured — approvals stay locked. */
  approvalAllowed: boolean;
  onAction: (key: string, entityId: string, kind: ChoreActionKind) => void;
}

export function RewardGoalCard({
  reward,
  owner,
  member,
  pending,
  blocked,
  approvalAllowed,
  onAction,
}: RewardGoalCardProps) {
  const { t } = useTranslation();
  const status = reward.status.toLowerCase();
  const claimEid = reward.actions.claim;
  const approveEid = reward.actions.approve;
  const declineEid = reward.actions.disapprove;

  // ChoreOps exposes no can_* flags on rewards: a locked reward cannot be
  // claimed, and review actions only make sense while a claim is pending.
  const canClaim = Boolean(claimEid) && status !== 'locked';
  const canReview = reward.pendingClaims > 0;

  const points = owner?.points ?? 0;
  const progress = reward.cost > 0 ? Math.min(100, Math.round((points / reward.cost) * 100)) : 0;

  return (
    <article className="choreops-goal" style={memberColorVars(member)}>
      <div className="choreops-goal-head">
        <span className="choreops-goal-icon" aria-hidden="true">
          {'\u{1F381}'}
        </span>
        <span className="choreops-goal-name">{reward.name}</span>
        <span className="choreops-goal-cost">
          {'\u{1F3C6}'} {reward.cost}
        </span>
      </div>

      <div
        className="choreops-goal-bar"
        role="progressbar"
        aria-label={reward.name}
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="choreops-goal-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="choreops-goal-meta">
        <span>{owner ? `${points} / ${reward.cost}` : reward.status}</span>
        <span>{progress}%</span>
      </div>

      {(canClaim || canReview) && (
        <div className="choreops-goal-actions">
          {canClaim && claimEid && (
            <button
              type="button"
              className="choreops-action"
              disabled={blocked || pending}
              onClick={() => onAction(`${reward.id}:claim`, claimEid, 'claim')}
            >
              <span className="choreops-action-main">{t('chores.claim')}</span>
              <span className="choreops-action-reward" aria-hidden="true">
                {'\u{1F3C6}'}
              </span>
            </button>
          )}
          {canReview && approveEid && (
            <button
              type="button"
              className="choreops-action"
              disabled={!approvalAllowed || blocked || pending}
              onClick={() => onAction(`${reward.id}:approve`, approveEid, 'approve')}
            >
              <span className="choreops-action-main">{t('chores.approve')}</span>
              <span className="choreops-action-reward" aria-hidden="true">
                {'\u2713'}
              </span>
            </button>
          )}
          {canReview && declineEid && (
            <button
              type="button"
              className="choreops-secondary"
              disabled={!approvalAllowed || blocked || pending}
              onClick={() => onAction(`${reward.id}:decline`, declineEid, 'disapprove')}
            >
              {t('chores.decline')}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
