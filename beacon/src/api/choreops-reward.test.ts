import { describe, it, expect } from 'vitest';
import { buildCreateRewardPayload } from './choreops';

describe('buildCreateRewardPayload', () => {
  it('requires a config entry, a name and at least one user', () => {
    expect(
      buildCreateRewardPayload({
        entryId: null,
        name: 'Film',
        cost: 10,
        assignedUserNames: ['Maya'],
      }),
    ).toBeNull();
    expect(
      buildCreateRewardPayload({
        entryId: 'e1',
        name: '  ',
        cost: 10,
        assignedUserNames: ['Maya'],
      }),
    ).toBeNull();
    expect(
      buildCreateRewardPayload({ entryId: 'e1', name: 'Film', cost: 10, assignedUserNames: [' '] }),
    ).toBeNull();
  });

  it('assigns the reward to the chosen children so each child can have their own', () => {
    const payload = buildCreateRewardPayload({
      entryId: 'entry-1',
      name: '  Naar de film  ',
      cost: 40.4,
      assignedUserNames: ['Maya', 'Maya', ' Nova '],
    });

    expect(payload).toEqual({
      config_entry_id: 'entry-1',
      name: 'Naar de film',
      cost: 40,
      assigned_user_names: ['Maya', 'Nova'],
    });
  });

  it('never sends a zero or negative cost, which ChoreOps would reject', () => {
    const payload = buildCreateRewardPayload({
      entryId: 'entry-1',
      name: 'Sticker',
      cost: 0,
      assignedUserNames: ['Maya'],
    });

    expect(payload).toMatchObject({ cost: 1 });
  });

  it('only includes a description when one was typed', () => {
    const withoutDescription = buildCreateRewardPayload({
      entryId: 'entry-1',
      name: 'Sticker',
      cost: 5,
      assignedUserNames: ['Maya'],
      description: '   ',
    });
    expect(withoutDescription).not.toHaveProperty('description');

    const withDescription = buildCreateRewardPayload({
      entryId: 'entry-1',
      name: 'Sticker',
      cost: 5,
      assignedUserNames: ['Maya'],
      description: ' Voor de stickerkaart ',
    });
    expect(withDescription).toMatchObject({ description: 'Voor de stickerkaart' });
  });
});
