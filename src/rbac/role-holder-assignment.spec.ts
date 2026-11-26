import { roleHolderAssignmentWhere } from './role-holder-assignment';

describe('roleHolderAssignmentWhere', () => {
  it('keeps active and pending assignments that have not ended or expired at now', () => {
    const now = new Date('2026-11-26T18:30:00.000Z');

    expect(roleHolderAssignmentWhere(now)).toEqual({
      active: true,
      status: { in: ['active', 'pending'] },
      AND: [
        {
          OR: [
            { end_date: null },
            { end_date: { gte: new Date('2026-11-26T00:00:00.000Z') } },
          ],
        },
        { OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
      ],
    });
  });

  it('does not filter on start_date, so future assignments count', () => {
    expect(roleHolderAssignmentWhere()).not.toHaveProperty('start_date');
  });
});
