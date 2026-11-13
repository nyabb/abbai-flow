import { describe, expect, it } from 'vitest';
import { parseChoreOpsRewardHistory } from './choreops-ledger';

describe('ChoreOps reward ledger parsing', () => {
  it('reads reward spends from the HA service response and ignores other ledger entries', () => {
    const history = parseChoreOpsRewardHistory({
      service_response: {
        assignee_name: 'Zara',
        entries: [
          {
            timestamp: '2026-11-12T18:30:00Z',
            amount: -20,
            balance_after: 5,
            source: 'rewards',
            item_name: 'Schermtijd',
            reference_id: 'reward-1',
          },
          {
            timestamp: '2026-11-12T18:00:00Z',
            amount: 10,
            balance_after: 25,
            source: 'chores',
            item_name: 'Afwassen',
            reference_id: 'chore-1',
          },
          {
            timestamp: '2026-11-11T18:00:00Z',
            amount: 20,
            balance_after: 25,
            source: 'rewards',
            item_name: 'Refund',
            reference_id: 'refund-1',
          },
        ],
      },
    });

    expect(history).toEqual([
      {
        id: 'reward-1',
        timestamp: '2026-11-12T18:30:00Z',
        timestampMs: Date.parse('2026-11-12T18:30:00Z'),
        amount: -20,
        balanceAfter: 5,
        itemName: 'Schermtijd',
        referenceId: 'reward-1',
      },
    ]);
  });

  it('accepts a service-keyed response and skips malformed entries', () => {
    expect(
      parseChoreOpsRewardHistory({
        service_response: {
          'choreops.get_ledger': {
            entries: [
              {
                timestamp: '2026-11-12T18:30:00Z',
                amount: '-20',
                source: 'rewards',
                item_name: 'Schermtijd',
              },
              { source: 'rewards', amount: -3, item_name: 'Missing timestamp' },
            ],
          },
        },
      }),
    ).toHaveLength(1);
  });
});
