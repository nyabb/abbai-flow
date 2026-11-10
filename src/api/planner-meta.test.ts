import { describe, it, expect } from 'vitest';
import {
  addRoutineTask,
  adoptLabels,
  clearMission,
  emptyMeta,
  findRoutine,
  importLegacyPauses,
  markMissionTaskDone,
  missionForUser,
  missionStep,
  moveRoutineTask,
  normaliseName,
  pruneRoutineTasks,
  removeRoutineTask,
  renameRoutine,
  routineIdForTask,
  routineSlug,
  routineTaskOrder,
  sanitizePlannerMeta,
  setRoutineTasks,
  startMission,
  toggleRoutinePaused,
  upsertRoutine,
} from './planner-meta';

describe('routine identity', () => {
  it('derives one stable slug per routine name', () => {
    expect(routineSlug('Ochtendroutine')).toBe('ochtendroutine');
    expect(routineSlug('  ochtendroutine  ')).toBe('ochtendroutine');
    expect(routineSlug('Bed tijd!')).toBe('bed-tijd');
    expect(routineSlug('Été')).toBe('ete');
  });

  it('reuses the existing routine instead of duplicating by capitalisation', () => {
    const first = upsertRoutine(emptyMeta(), 'Ochtendroutine');
    const second = upsertRoutine(first.meta, 'ochtendroutine ');
    const third = upsertRoutine(second.meta, 'OCHTENDROUTINE');

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(second.meta.routines).toHaveLength(1);
    expect(second.routine.id).toBe(first.routine.id);
  });

  it('gives genuinely different names different ids', () => {
    const morning = upsertRoutine(emptyMeta(), 'Ochtendroutine');
    const evening = upsertRoutine(morning.meta, 'Avondroutine');
    expect(evening.routine.id).not.toBe(morning.routine.id);
    expect(evening.meta.routines).toHaveLength(2);
  });

  it('finds a routine by id, name or slug', () => {
    const { meta } = upsertRoutine(emptyMeta(), 'Bedtijd');
    expect(findRoutine(meta, 'bedtijd')?.name).toBe('Bedtijd');
    expect(findRoutine(meta, 'BEDTIJD ')?.name).toBe('Bedtijd');
    expect(findRoutine(meta, 'onbekend')).toBeNull();
  });

  it('renames without losing the task links', () => {
    const created = upsertRoutine(emptyMeta(), 'Ochtend');
    const withTask = addRoutineTask(created.meta, created.routine.id, 'Tanden poetsen');
    const renamed = renameRoutine(withTask, created.routine.id, 'Ochtendroutine');

    expect(findRoutine(renamed, 'Ochtendroutine')?.taskNames).toEqual(['Tanden poetsen']);
  });
});

describe('routine task membership', () => {
  const base = (() => {
    const created = upsertRoutine(emptyMeta(), 'Ochtendroutine');
    return { id: created.routine.id, meta: created.meta };
  })();

  it('keeps order and ignores duplicates', () => {
    let meta = addRoutineTask(base.meta, base.id, 'Tanden poetsen');
    meta = addRoutineTask(meta, base.id, 'Aankleden');
    meta = addRoutineTask(meta, base.id, 'tanden POETSEN');

    expect(routineTaskOrder(meta, base.id)).toEqual(['Tanden poetsen', 'Aankleden']);
  });

  it('reorders a task one step at a time', () => {
    let meta = setRoutineTasks(base.meta, base.id, ['A', 'B', 'C']);
    meta = moveRoutineTask(meta, base.id, 'C', -1);
    expect(routineTaskOrder(meta, base.id)).toEqual(['A', 'C', 'B']);
    meta = moveRoutineTask(meta, base.id, 'A', -1);
    expect(routineTaskOrder(meta, base.id)).toEqual(['A', 'C', 'B']);
  });

  it('removes a task without touching the others', () => {
    const meta = setRoutineTasks(base.meta, base.id, ['A', 'B']);
    expect(routineTaskOrder(removeRoutineTask(meta, base.id, 'a'), base.id)).toEqual(['B']);
  });

  it('resolves a chore to its routine through the registry, then the label', () => {
    const meta = addRoutineTask(base.meta, base.id, 'Tanden poetsen');
    expect(routineIdForTask(meta, 'Tanden poetsen')).toBe(base.id);
    // Unknown chore with a label that matches a routine → that routine.
    expect(routineIdForTask(meta, 'Iets anders', 'Ochtendroutine')).toBe(base.id);
    // Unknown label → synthetic id so legacy groups still appear.
    expect(routineIdForTask(meta, 'Iets anders', 'Avond')).toBe('routine:avond');
    expect(routineIdForTask(meta, 'Iets anders', null)).toBeNull();
  });

  it('pauses and resumes', () => {
    const paused = toggleRoutinePaused(base.meta, base.id);
    expect(paused.routines[0].paused).toBe(true);
    expect(toggleRoutinePaused(paused, base.id).routines[0].paused).toBe(false);
  });

  it('adopts existing ChoreOps labels as routines', () => {
    const meta = adoptLabels(emptyMeta(), [
      { label: 'Ochtendroutine', taskNames: ['Tanden poetsen', 'Aankleden'] },
      { label: 'ochtendroutine', taskNames: ['Haar doen'] },
    ]);

    expect(meta.routines).toHaveLength(1);
    expect(meta.routines[0].taskNames).toEqual(['Tanden poetsen', 'Aankleden', 'Haar doen']);
  });

  it('drops chores that no longer exist in ChoreOps', () => {
    const meta = setRoutineTasks(base.meta, base.id, ['A', 'B']);
    expect(routineTaskOrder(pruneRoutineTasks(meta, ['A']), base.id)).toEqual(['A']);
  });

  it('imports the old per-device pause flag once', () => {
    const meta = importLegacyPauses(base.meta, [base.id]);
    expect(meta.routines[0].paused).toBe(true);
    expect(importLegacyPauses(meta, [base.id])).toBe(meta);
  });
});

describe('mission progress', () => {
  const created = upsertRoutine(emptyMeta(), 'Ochtendroutine');
  const id = created.routine.id;
  const meta = setRoutineTasks(created.meta, id, ['A', 'B', 'C']);

  it('counts each step once, even when the same step is marked twice', () => {
    let next = startMission(meta, 'Nova', id);
    next = markMissionTaskDone(next, 'Nova', id, 'A');
    next = markMissionTaskDone(next, 'Nova', id, 'A');

    expect(missionForUser(next, 'nova')?.completed).toEqual(['A']);
    expect(missionStep(next, 'Nova', id)).toEqual({ done: 1, total: 3 });
  });

  it('survives a reload: progress is part of the document, not the UI', () => {
    let next = startMission(meta, 'Nova', id);
    next = markMissionTaskDone(next, 'Nova', id, 'A');
    const restored = sanitizePlannerMeta(JSON.parse(JSON.stringify(next)));

    expect(missionStep(restored, 'Nova', id)).toEqual({ done: 1, total: 3 });
  });

  it('starts a clean run when the routine changes', () => {
    let next = startMission(meta, 'Nova', id);
    next = markMissionTaskDone(next, 'Nova', id, 'A');
    next = startMission(next, 'Nova', 'routine:avond');

    expect(missionForUser(next, 'Nova')?.completed).toEqual([]);
  });

  it('clears a finished run', () => {
    let next = startMission(meta, 'Nova', id);
    next = markMissionTaskDone(next, 'Nova', id, 'A');
    expect(missionForUser(clearMission(next, 'Nova'), 'Nova')).toBeNull();
  });

  it('ignores steps from a different routine', () => {
    let next = startMission(meta, 'Nova', 'routine:avond');
    next = markMissionTaskDone(next, 'Nova', id, 'A');
    expect(missionStep(next, 'Nova', id).done).toBe(0);
  });
});

describe('sanitizePlannerMeta', () => {
  it('survives junk without throwing', () => {
    expect(sanitizePlannerMeta(null).routines).toEqual([]);
    expect(sanitizePlannerMeta('nope').missions).toEqual({});
    expect(sanitizePlannerMeta({ routines: [{ name: '' }] }).routines).toEqual([]);
  });

  it('keeps valid routines and drops duplicate ids', () => {
    const meta = sanitizePlannerMeta({
      routines: [
        { id: 'ochtend', name: 'Ochtend', taskNames: ['A'] },
        { id: 'ochtend', name: 'Dubbel', taskNames: ['B'] },
      ],
      missions: { Nova: { routineId: 'ochtend', completed: ['A'] } },
    });

    expect(meta.routines).toHaveLength(1);
    expect(meta.missions.nova.completed).toEqual(['A']);
    expect(normaliseName(' Nova ')).toBe('nova');
  });
});
