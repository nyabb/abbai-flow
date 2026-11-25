import { describe, it, expect } from 'vitest';
import { buildCreateRewardPayload } from './chore-model';

describe('buildCreateRewardPayload', () => {
  it('requires a name and at least one user', () => {
    expect(
      buildCreateRewardPayload({
        name: '  ',
        cost: 10,
        assignedUserNames: ['Maya'],
      }),
    ).toBeNull();
    expect(
      buildCreateRewardPayload({ name: 'Film', cost: 10, assignedUserNames: [' '] }),
    ).toBeNull();
  });

  it('assigns the reward to the chosen children so each child can have their own', () => {
    const payload = buildCreateRewardPayload({
      name: '  Naar de film  ',
      cost: 40.4,
      assignedUserNames: ['Maya', 'Maya', ' Nova '],
    });

    expect(payload).toEqual({
      name: 'Naar de film',
      cost: 40,
      assigned_user_names: ['Maya', 'Nova'],
    });
  });

  it('never sends a zero or negative cost, which ChoresMan would reject', () => {
    const payload = buildCreateRewardPayload({
      name: 'Sticker',
      cost: 0,
      assignedUserNames: ['Maya'],
    });

    expect(payload).toMatchObject({ cost: 1 });
  });

  it('only includes a description when one was typed', () => {
    const withoutDescription = buildCreateRewardPayload({
      name: 'Sticker',
      cost: 5,
      assignedUserNames: ['Maya'],
      description: '   ',
    });
    expect(withoutDescription).not.toHaveProperty('description');

    const withDescription = buildCreateRewardPayload({
      name: 'Sticker',
      cost: 5,
      assignedUserNames: ['Maya'],
      description: ' Voor de stickerkaart ',
    });
    expect(withDescription).toMatchObject({ description: 'Voor de stickerkaart' });
  });

  it('marks app-created reward proposals as awaiting parent approval', () => {
    const payload = buildCreateRewardPayload({
      name: 'Movie night',
      cost: 20,
      assignedUserNames: ['Maya'],
      approvalRequired: true,
    });

    expect(payload).toMatchObject({ approved: false });
  });
});
