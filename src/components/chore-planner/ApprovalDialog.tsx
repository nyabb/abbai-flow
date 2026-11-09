/**
 * The two blocking dialogs of the chores screen:
 *
 *  - `ConfirmSheet` asks a child to confirm the chore they tapped before
 *    anything is sent to ChoreOps (a mis-tap on a shared display would
 *    otherwise hand out points).
 *  - `PinSheet` asks for a parent PIN before a destructive or approval action.
 */
import type { PlannerCopy } from './copy';

export interface ConfirmAction {
  taskId: string;
  entityId: string;
  label: string;
  /** `done` for a parent sign-off, `claim` when the child takes the chore. */
  kind: 'claim' | 'done';
  /** What the toast says afterwards, e.g. "Geclaimd" or "Goedgekeurd". */
  action: string;
}

export function ConfirmSheet({
  action,
  copy: c,
  pending,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction;
  copy: PlannerCopy;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (action: ConfirmAction) => void;
}) {
  const claiming = action.kind === 'claim';
  return (
    <div className="planner-backdrop" onClick={onCancel}>
      <section
        className="planner-sheet planner-sheet--confirm"
        role="dialog"
        aria-modal="true"
        aria-label={claiming ? c.confirmClaimTitle : c.confirmDoneTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{claiming ? c.confirmClaimTitle : c.confirmDoneTitle}</h2>
        <p>{claiming ? c.confirmClaimBody : c.confirmDoneBody}</p>
        <p className="planner-confirm-target">{action.label}</p>
        <footer className="planner-sheet-footer">
          <button className="planner-ghost" onClick={onCancel}>
            {c.cancel}
          </button>
          <button className="planner-primary" disabled={pending} onClick={() => onConfirm(action)}>
            {c.confirm}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function PinSheet({
  gate,
  copy: c,
  value,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  gate: { title: string; description: string };
  copy: PlannerCopy;
  value: string;
  error: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="planner-backdrop" onClick={onCancel}>
      <section
        className="planner-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={c.pinTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{c.pinTitle}</h2>
        <p>
          {gate.title} · {gate.description}
        </p>
        <p>{c.pinHint}</p>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={6}
          aria-label={c.pinTitle}
          className="planner-pin-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit();
            if (event.key === 'Escape') onCancel();
          }}
        />
        {error && (
          <p className="planner-validation" role="alert">
            {c.pinWrong}
          </p>
        )}
        <footer className="planner-sheet-footer">
          <button className="planner-ghost" onClick={onCancel}>
            {c.cancel}
          </button>
          <button className="planner-primary" onClick={onSubmit}>
            {c.pinConfirm}
          </button>
        </footer>
      </section>
    </div>
  );
}
