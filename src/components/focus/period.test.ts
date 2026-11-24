import { describe, expect, it } from 'vitest';
import type { Routine } from '../../types/family';
import { pickRoutines } from './period';

const routine = (id: string, time_of_day: Routine['time_of_day']): Routine => ({
  id,
  name: id,
  member_id: 'member-1',
  time_of_day,
  tasks: [],
});

describe('pickRoutines', () => {
  it('returns every routine for the current period as interactive', () => {
    const picks = pickRoutines(
      [
        routine('morning-one', 'morning'),
        routine('morning-two', 'morning'),
        routine('later', 'evening'),
      ],
      new Date(2024, 0, 2, 8, 0),
    );

    expect(picks.map(({ routine: item, isCurrent, label }) => [item.id, isCurrent, label])).toEqual(
      [
        ['morning-one', true, ''],
        ['morning-two', true, ''],
      ],
    );
  });

  it('previews the next period and never makes it interactive early', () => {
    const picks = pickRoutines(
      [routine('evening-one', 'evening'), routine('evening-two', 'evening')],
      new Date(2024, 0, 2, 13, 0),
    );

    expect(picks.map(({ routine: item, isCurrent, label }) => [item.id, isCurrent, label])).toEqual(
      [
        ['evening-one', false, 'Tonight'],
        ['evening-two', false, 'Tonight'],
      ],
    );
  });

  it('wraps previews from evening to the next morning', () => {
    const picks = pickRoutines(
      [routine('morning-one', 'morning'), routine('morning-two', 'morning')],
      new Date(2024, 0, 2, 20, 0),
    );

    expect(picks.map(({ routine: item, isCurrent, label }) => [item.id, isCurrent, label])).toEqual(
      [
        ['morning-one', false, 'Tomorrow morning'],
        ['morning-two', false, 'Tomorrow morning'],
      ],
    );
  });

  it('previews routines scheduled for tomorrow after the current day wraps', () => {
    const tuesdayMorning = {
      ...routine('tuesday-morning', 'morning'),
      days_of_week: [2],
    };
    const picks = pickRoutines([tuesdayMorning], new Date(2024, 0, 1, 20, 0));

    expect(picks.map(({ routine: item, isCurrent, label }) => [item.id, isCurrent, label])).toEqual(
      [['tuesday-morning', false, 'Tomorrow morning']],
    );
  });
});
