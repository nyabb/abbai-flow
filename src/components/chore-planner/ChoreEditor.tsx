/**
 * The chore editor sheet: everything a parent can change about a chore —
 * name, points, assignees, routine label, repeat schedule, due date, window,
 * reminder and parent-free approval.
 *
 * It is a controlled form: the planner owns the `FormValue`, the sheet only
 * renders it and asks for changes.
 */
import type { Dispatch, SetStateAction } from 'react';
import { CHOREOPS_FREQUENCIES, CHOREOPS_INTERVAL_UNITS } from '../../api/choreops';
import type { ChoreOpsFrequency, ChoreOpsIntervalUnit } from '../../api/choreops';
import type { PlannerMember } from '../../api/chore-planner-model';
import type { I18nValue } from '../../i18n';
import { MemberAvatar } from '../MemberAvatar';
import type { PlannerCopy } from './copy';
import { DAY_KEYS, FREQUENCY_KEY, UNIT_KEY, type FormValue } from './form';

export interface ChoreEditorProps {
  form: FormValue;
  setForm: Dispatch<SetStateAction<FormValue>>;
  members: PlannerMember[];
  /** Present when editing; the name cannot be changed in ChoreOps. */
  editingId: string | null;
  saving: boolean;
  copy: PlannerCopy;
  t: I18nValue['t'];
  /** Existing routine names, so the field is a picker instead of free text. */
  routineNames?: string[];
  onCancel: () => void;
  onSave: () => void;
}

export function ChoreEditor({
  form,
  setForm,
  members,
  editingId,
  saving,
  copy: c,
  t,
  routineNames = [],
  onCancel,
  onSave,
}: ChoreEditorProps) {
  /*
   * A routine repeats and carries the routine label; a task happens once. The
   * reference model puts recurrence on routines only, and ChoreOps agrees --
   * a chore without a repeat is a one-off. So a NEW task hides the label and
   * schedule fields entirely and is created as `none`, while a new routine
   * chooses its repeat explicitly (daily by default, weekly adds the weekday
   * pills).
   *
   * Editing always shows them: an existing chore may already be weekly or use
   * a custom interval, and hiding that would silently rewrite what ChoreOps has
   * the moment it is saved.
   */
  const showSchedule = form.kind === 'routine' || Boolean(editingId);

  return (
    <>
      <h2>{editingId ? c.edit : c.add}</h2>
      <label className="planner-field">
        {c.name}
        <input
          autoFocus
          value={form.name}
          disabled={Boolean(editingId)}
          onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
        />
        {editingId && <small className="planner-hint">{c.renameLocked}</small>}
      </label>
      <label className="planner-field">
        {c.points}
        <div className="planner-stepper">
          <button
            onClick={() =>
              setForm((value) => ({ ...value, points: Math.max(0, value.points - 1) }))
            }
          >
            −
          </button>
          <strong>{form.points}</strong>
          <button
            onClick={() =>
              setForm((value) => ({ ...value, points: Math.min(100, value.points + 1) }))
            }
          >
            +
          </button>
        </div>
      </label>
      <fieldset className="planner-field">
        <legend>{c.forWho}</legend>
        <div className="planner-member-picker">
          <button
            className={form.memberIds.length === members.length && !form.free ? 'is-selected' : ''}
            onClick={() =>
              setForm((value) => ({
                ...value,
                free: false,
                memberIds:
                  value.memberIds.length === members.length ? [] : members.map((m) => m.id),
              }))
            }
          >
            {c.everyone}
          </button>
          {members.map((member) => (
            <button
              key={member.id}
              className={form.memberIds.includes(member.id) ? 'is-selected' : ''}
              onClick={() =>
                setForm((value) => ({
                  ...value,
                  free: false,
                  memberIds: value.memberIds.includes(member.id)
                    ? value.memberIds.filter((id) => id !== member.id)
                    : [...value.memberIds, member.id],
                }))
              }
            >
              <span>
                <MemberAvatar member={member} />
              </span>
              {member.name}
            </button>
          ))}
        </div>
        <label className="planner-check-label">
          <input
            type="checkbox"
            checked={form.free}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                free: event.target.checked,
                memberIds: event.target.checked ? [] : value.memberIds,
              }))
            }
          />
          {c.freeTask}
        </label>
      </fieldset>
      <label className="planner-field">
        {c.description}
        <input
          value={form.liveDescription}
          onChange={(event) =>
            setForm((value) => ({ ...value, liveDescription: event.target.value }))
          }
        />
      </label>
      {!showSchedule && <p className="planner-hint">{c.taskOnceHint}</p>}
      {showSchedule && (
        <label className="planner-field">
          {c.routineLabel}
          <input
            list="planner-routine-names"
            value={form.liveLabel}
            placeholder={c.routinePlaceholder}
            onChange={(event) => setForm((value) => ({ ...value, liveLabel: event.target.value }))}
          />
          {/* Pick an existing routine, or type a new name to create one. */}
          <datalist id="planner-routine-names">
            {routineNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <small className="planner-hint">{c.routineHint}</small>
        </label>
      )}
      {showSchedule && (
        <label className="planner-field">
          {c.frequency}
          <select
            value={form.liveFrequency}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                liveFrequency: event.target.value as ChoreOpsFrequency,
              }))
            }
          >
            {CHOREOPS_FREQUENCIES.map((frequency) => (
              <option key={frequency} value={frequency}>
                {t(FREQUENCY_KEY[frequency])}
              </option>
            ))}
          </select>
        </label>
      )}
      {showSchedule && form.liveFrequency === 'weekly' && (
        <div className="planner-weekdays">
          {DAY_KEYS.map((day, index) => (
            <button
              key={index}
              className={form.liveWeekdays.includes(index) ? 'is-selected' : ''}
              onClick={() =>
                setForm((value) => ({
                  ...value,
                  liveWeekdays: value.liveWeekdays.includes(index)
                    ? value.liveWeekdays.filter((item) => item !== index)
                    : [...value.liveWeekdays, index],
                }))
              }
            >
              {t(`planner.day.${day}`)}
            </button>
          ))}
        </div>
      )}
      {showSchedule &&
        (form.liveFrequency === 'custom' || form.liveFrequency === 'custom_from_complete') && (
          <>
            <label className="planner-field">
              {c.interval}
              <input
                type="number"
                min="1"
                max="365"
                value={form.liveInterval}
                onChange={(event) =>
                  setForm((value) => ({ ...value, liveInterval: Number(event.target.value) }))
                }
              />
            </label>
            <label className="planner-field">
              {c.every}
              <select
                value={form.liveIntervalUnit}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    liveIntervalUnit: event.target.value as ChoreOpsIntervalUnit,
                  }))
                }
              >
                {CHOREOPS_INTERVAL_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(UNIT_KEY[unit])}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      <label className="planner-field">
        {c.dueAt}
        <input
          type="datetime-local"
          value={form.deadlineAt}
          onChange={(event) => setForm((value) => ({ ...value, deadlineAt: event.target.value }))}
        />
      </label>
      <label className="planner-field">
        {c.dueWindow}
        <input
          value={form.liveWindow}
          placeholder="1h"
          onChange={(event) => setForm((value) => ({ ...value, liveWindow: event.target.value }))}
        />
        <small className="planner-hint">{c.dueWindowHint}</small>
      </label>
      <label className="planner-field">
        {c.reminder}
        <input
          value={form.liveReminder}
          placeholder="30m"
          onChange={(event) => setForm((value) => ({ ...value, liveReminder: event.target.value }))}
        />
        <small className="planner-hint">{c.reminderHint}</small>
      </label>
      <label className="planner-check-label">
        <input
          type="checkbox"
          checked={form.liveAutoApprove}
          onChange={(event) =>
            setForm((value) => ({ ...value, liveAutoApprove: event.target.checked }))
          }
        />
        {c.autoApprove}
      </label>
      <footer className="planner-sheet-footer">
        <button className="planner-ghost" onClick={onCancel}>
          {c.cancel}
        </button>
        <button
          className="planner-primary"
          disabled={
            !form.name.trim() ||
            (!form.memberIds.length && !form.free) ||
            // A routine is only a routine once it has a name to group under.
            (form.kind === 'routine' && !editingId && !form.liveLabel.trim()) ||
            saving
          }
          onClick={onSave}
        >
          {saving ? '\u2026' : editingId ? c.save : c.create}
        </button>
      </footer>
    </>
  );
}
