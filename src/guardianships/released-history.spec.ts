import { GuardianshipsService } from './guardianships.service';

const GUARDIAN = '11111111-1111-4111-8111-111111111111';

const profile = (over: Record<string, unknown> = {}) => ({
  released_at: new Date('2026-11-01T00:00:00.000Z'),
  release_completed_at: null,
  frozen_at: null,
  frozen_reason: null,
  purged_at: null,
  ...over,
});

const row = (
  id: string,
  over: Record<string, unknown> = {},
  dep: any = {},
) => ({
  guardianship_id: `g-${id}`,
  dependent_user_id: `d-${id}`,
  revoked_at: new Date('2026-11-01T00:00:00.000Z'),
  relationship_type: { name: 'Madre' },
  dependent: {
    name: 'Ana',
    paternal_last_name: 'Pérez',
    account: [],
    supervised_login: null,
    dependent_profile: profile(),
    ...dep,
  },
  ...over,
});

function setup(rows: any[]) {
  const prisma: any = {
    guardianships: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  const service = new GuardianshipsService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, prisma };
}

describe('GuardianshipsService.listReleasedHistory (Phase 4b)', () => {
  it('reads ONLY this guardian’s rows revoked with reason released, newest first, capped at 50', async () => {
    const { service, prisma } = setup([]);
    await expect(service.listReleasedHistory(GUARDIAN)).resolves.toEqual({
      released: [],
    });
    expect(prisma.guardianships.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          guardian_user_id: GUARDIAN,
          consent_status: 'revoked',
          revoked_reason: 'released',
        },
        orderBy: { revoked_at: 'desc' },
        take: 50,
      }),
    );
  });

  it('returns a MINIMAL entry: no health, club, progress or contact fields', async () => {
    const { service } = setup([row('1')]);
    const { released } = await service.listReleasedHistory(GUARDIAN);
    expect(released).toEqual([
      {
        guardianship_id: 'g-1',
        dependent_user_id: 'd-1',
        display_name: 'Ana Pérez',
        relationship_type_name: 'Madre',
        released_at: '2026-11-01T00:00:00.000Z',
        can_issue_claim: true,
      },
    ]);
  });

  it('a purged person has a null name and cannot be claimed', async () => {
    const { service } = setup([
      row('1', {}, { dependent_profile: profile({ purged_at: new Date() }) }),
    ]);
    const [entry] = (await service.listReleasedHistory(GUARDIAN)).released;
    expect(entry.display_name).toBeNull();
    expect(entry.can_issue_claim).toBe(false);
  });

  it('the entry remains after a majority freeze, and R6 keeps the claim available', async () => {
    const { service } = setup([
      row(
        '1',
        {},
        {
          dependent_profile: profile({
            frozen_at: new Date(),
            frozen_reason: 'majority_release',
          }),
        },
      ),
    ]);
    const [entry] = (await service.listReleasedHistory(GUARDIAN)).released;
    expect(entry.can_issue_claim).toBe(true);
  });

  it('no claim once the person has credentials, completed the release or has a legacy freeze', async () => {
    const { service } = setup([
      row('acc', {}, { account: [{ id: 'a' }] }),
      row('login', {}, { supervised_login: { user_id: 'x' } }),
      row(
        'done',
        {},
        { dependent_profile: profile({ release_completed_at: new Date() }) },
      ),
      row(
        'legacy',
        {},
        {
          dependent_profile: profile({
            frozen_at: new Date(),
            frozen_reason: null,
          }),
        },
      ),
    ]);
    const { released } = await service.listReleasedHistory(GUARDIAN);
    expect(released.map((entry) => entry.can_issue_claim)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
