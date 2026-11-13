import { SupervisionStateService } from './supervision-state.service';

describe('SupervisionStateService.describe', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');

  function build(rows: unknown[], pendingSince: Date | null) {
    const prisma = {
      supervised_logins: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ pending_since: pendingSince }),
      },
      guardianships: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    return {
      service: new SupervisionStateService(
        prisma as never,
        { isEnabled: () => false } as never,
        {} as never,
      ),
      prisma,
    };
  }

  it('exposes the guardianship id and consent status so the teen can revoke a pending link', async () => {
    const { service, prisma } = build(
      [
        {
          guardianship_id: 'g-1',
          consent_status: 'pending',
          guardian: { name: 'Ana', paternal_last_name: 'Ruiz' },
          relationship_type: { name: 'Madre' },
        },
      ],
      null,
    );

    const view = await service.describe('teen-1', 'pending_guardian', now);

    expect(view.guardians).toEqual([
      expect.objectContaining({
        guardianship_id: 'g-1',
        consent_status: 'pending',
        relationship_type_name: 'Madre',
      }),
    ]);
    expect(prisma.guardianships.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          guardianship_id: true,
          consent_status: true,
        }),
      }),
    );
  });

  it('never exposes guardian contact data', async () => {
    const { service } = build(
      [
        {
          guardianship_id: 'g-2',
          consent_status: 'verified',
          guardian: { name: 'Luis', paternal_last_name: 'Diaz' },
          relationship_type: null,
        },
      ],
      null,
    );

    const view = await service.describe('teen-1', 'active', now);

    expect(Object.keys(view.guardians[0]).sort()).toEqual([
      'consent_status',
      'display_name',
      'guardianship_id',
      'relationship_type_name',
    ]);
  });

  it('counts days left only while no guardian is linked', async () => {
    const { service } = build([], new Date('2026-10-10T12:00:00.000Z'));

    const view = await service.describe('teen-1', 'pending_guardian', now);

    expect(view.days_left).toBe(80);
    expect(view.pending_since).toBe('2026-10-10T12:00:00.000Z');
  });

  describe('majority notice (Phase 4)', () => {
    function buildWithRelease(user: unknown, flagOn = true) {
      const prisma = {
        supervised_logins: {
          findUnique: jest.fn().mockResolvedValue({ pending_since: null }),
        },
        guardianships: { findMany: jest.fn().mockResolvedValue([]) },
        users: { findUnique: jest.fn().mockResolvedValue(user) },
      };
      const policy = {
        getPolicy: jest.fn().mockResolvedValue({
          ageOfMajority: 18,
          minSelfLoginAge: 13,
          timeZone: 'UTC',
        }),
      };
      const service = new SupervisionStateService(
        prisma as never,
        { isEnabled: () => flagOn } as never,
        policy as never,
      );
      return { service, prisma };
    }

    it('flag off: no extra query, null date, notice not sent', async () => {
      const { service, prisma } = buildWithRelease(null, false);
      const view = await service.describe('t', 'active', now);
      expect(view.majority_date).toBeNull();
      expect(view.release_notice_sent).toBe(false);
      expect(prisma.users.findUnique).not.toHaveBeenCalled();
    });

    it('inside the 30-day window: majority date and notice flag', async () => {
      const { service } = buildWithRelease({
        birthday: new Date('2008-11-10T00:00:00.000Z'),
        country_id: null,
        dependent_profile: { majority_notice_sent_at: new Date() },
      });
      const view = await service.describe('t', 'active', now);
      expect(view.majority_date).toBe('2026-11-10');
      expect(view.release_notice_sent).toBe(true);
    });

    it('outside the window the date stays null', async () => {
      const { service } = buildWithRelease({
        birthday: new Date('2009-11-10T00:00:00.000Z'),
        country_id: null,
        dependent_profile: null,
      });
      const view = await service.describe('t', 'active', now);
      expect(view.majority_date).toBeNull();
      expect(view.release_notice_sent).toBe(false);
    });
  });
});
