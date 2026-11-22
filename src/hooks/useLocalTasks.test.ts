import { describe, expect, it } from 'vitest';
import { migrateLegacyLocalTaskIds } from './useLocalTasks';

describe('migrateLegacyLocalTaskIds', () => {
  it('renames built-in and custom Beacon list ids without losing task links', () => {
    const migrated = migrateLegacyLocalTaskIds(
      [
        { id: 'beacon-todo', name: 'To-Do' },
        { id: 'beacon-shopping', name: 'Shopping List' },
        { id: 'beacon-1712345678', name: 'Household' },
      ],
      [
        {
          id: 'task-1',
          summary: 'Buy apples',
          status: 'needs_action',
          listId: 'beacon-shopping',
          createdAt: '2026-11-22T00:00:00.000Z',
        },
      ],
    );

    expect(migrated.lists.map((list) => list.id)).toEqual([
      'abbai-flow-todo',
      'abbai-flow-shopping',
      'abbai-flow-1712345678',
    ]);
    expect(migrated.tasks[0].listId).toBe('abbai-flow-shopping');
  });
});
