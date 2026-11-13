import { describe, expect, it } from 'vitest';
import { parseChoreOpsChoreHistory } from './choreops-chore-history';

describe('ChoreOps chore history parsing', () => {
  it('keeps completed and approved states for the requested child chores', () => {
    const entities = [
      { entityId: 'sensor.zara_choreops_chore_status_dishes', choreName: 'Dishes', points: 5 },
    ];
    const history = parseChoreOpsChoreHistory(
      [
        [
          {
            entity_id: entities[0].entityId,
            state: 'completed',
            last_changed: '2026-11-12T18:30:00Z',
            attributes: { chore_name: 'Dishes', default_points: 7 },
          },
          {
            entity_id: entities[0].entityId,
            state: 'pending',
            last_changed: '2026-11-13T00:00:00Z',
            attributes: {},
          },
          {
            entity_id: entities[0].entityId,
            state: 'approved',
            last_changed: '2026-11-13T08:00:00Z',
            attributes: {},
          },
          {
            entity_id: entities[0].entityId,
            state: 'completed_by_other',
            last_changed: '2026-11-13T09:00:00Z',
            attributes: {},
          },
          {
            entity_id: 'sensor.someone_else_chore_status',
            state: 'completed',
            last_changed: '2026-11-13T10:00:00Z',
            attributes: {},
          },
        ],
      ],
      entities,
    );

    expect(history).toEqual([
      {
        id: `${entities[0].entityId}:2026-11-13T08:00:00Z`,
        entityId: entities[0].entityId,
        choreName: 'Dishes',
        completedAt: '2026-11-13T08:00:00Z',
        completedAtMs: Date.parse('2026-11-13T08:00:00Z'),
        points: 5,
      },
      {
        id: `${entities[0].entityId}:2026-11-12T18:30:00Z`,
        entityId: entities[0].entityId,
        choreName: 'Dishes',
        completedAt: '2026-11-12T18:30:00Z',
        completedAtMs: Date.parse('2026-11-12T18:30:00Z'),
        points: 7,
      },
    ]);
  });

  it('returns an empty history when no status entities are available', () => {
    expect(parseChoreOpsChoreHistory([[{ state: 'completed' }]], [])).toEqual([]);
  });
});
