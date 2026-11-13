import { ErrorCode } from '../common/errors/error-codes';
import { AdultClaimIssueService } from './adult-claim-issue.service';

const GUARDIAN = '44444444-4444-4444-8444-444444444444';
const DEPENDENT = '33333333-3333-4333-8333-333333333333';

const target = (over: Record<string, unknown> = {}) => ({
  active: true,
  account: [],
  supervised_login: null,
  dependent_profile: {
    released_at: new Date('2026-11-01'),
    release_completed_at: null,
    frozen_at: null,
    frozen_reason: null,
    purged_at: null,
  },
  ...over,
});

function setup(
  options: { former?: any; released?: any[]; live?: any; target?: any } = {},
) {
  const prisma: any = {
    guardianships: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.former === undefined
            ? { guardianship_id: 'g-1' }
            : options.former,
        ),
      findMany: jest.fn().mockResolvedValue(options.released ?? []),
    },
    club_role_assignments: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.live === undefined ? { assignment_id: 'a' } : options.live,
        ),
    },
    users: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.target === undefined ? target() : options.target,
        ),
    },
  };
  const linkCodes = {
    issueAdultClaimCode: jest.fn().mockResolvedValue({
      code: 'AAAA-BBBB',
      expires_at: '2026-11-26T00:00:00.000Z',
    }),
  };
  const audit = { recordEventOrThrow: jest.fn().mockResolvedValue(undefined) };
  const service = new AdultClaimIssueService(
    prisma,
    linkCodes as any,
    audit as any,
  );
  return { service, prisma, linkCodes, audit };
}

describe('AdultClaimIssueService.issueForFormerGuardian', () => {
  it('issues for the guardian revoked with reason released; audit never holds the code', async () => {
    const ctx = setup();
    await expect(
      ctx.service.issueForFormerGuardian(GUARDIAN, DEPENDENT),
    ).resolves.toMatchObject({ code: 'AAAA-BBBB' });
    expect(
      ctx.prisma.guardianships.findFirst.mock.calls[0][0].where,
    ).toMatchObject({
      guardian_user_id: GUARDIAN,
      dependent_user_id: DEPENDENT,
      revoked_reason: 'released',
    });
    expect(ctx.linkCodes.issueAdultClaimCode).toHaveBeenCalledWith({
      dependentId: DEPENDENT,
      issuedBy: GUARDIAN,
      clubSectionId: null,
    });
    const audit = ctx.audit.recordEventOrThrow.mock.calls[0][0];
    expect(audit.action).toBe('family.adult_claim.issued');
    expect(JSON.stringify(audit)).not.toContain('AAAA-BBBB');
  });

  it('404 when the caller was never a guardian of that person (or the row was not a release)', async () => {
    const ctx = setup({ former: null });
    await expect(
      ctx.service.issueForFormerGuardian(GUARDIAN, DEPENDENT),
    ).rejects.toMatchObject({
      code: ErrorCode.GUARDIANSHIP_NOT_FOUND,
      status: 404,
    });
    expect(ctx.linkCodes.issueAdultClaimCode).not.toHaveBeenCalled();
  });

  it('409 NOT_RELEASED when the person already has an account', async () => {
    const ctx = setup({ target: target({ account: [{ id: 'a' }] }) });
    await expect(
      ctx.service.issueForFormerGuardian(GUARDIAN, DEPENDENT),
    ).rejects.toMatchObject({
      code: ErrorCode.FAMILY_ADULT_CLAIM_NOT_RELEASED,
      status: 409,
    });
  });

  it('R6: also works while frozen by the release (no deadline)', async () => {
    const ctx = setup({
      target: target({
        dependent_profile: {
          released_at: new Date('2026-09-01'),
          release_completed_at: null,
          frozen_at: new Date('2026-10-05'),
          frozen_reason: 'majority_release',
          purged_at: null,
        },
      }),
    });
    await expect(
      ctx.service.issueForFormerGuardian(GUARDIAN, DEPENDENT),
    ).resolves.toBeDefined();
  });

  it('a purged person is 404; a legacy freeze or a completed release is 409', async () => {
    const purged = setup({
      target: target({
        dependent_profile: {
          released_at: new Date(),
          release_completed_at: null,
          frozen_at: new Date(),
          frozen_reason: 'majority_release',
          purged_at: new Date(),
        },
      }),
    });
    await expect(
      purged.service.issueForFormerGuardian(GUARDIAN, DEPENDENT),
    ).rejects.toMatchObject({ status: 404 });

    const legacy = setup({
      target: target({
        dependent_profile: {
          released_at: new Date(),
          release_completed_at: null,
          frozen_at: new Date(),
          frozen_reason: null,
          purged_at: null,
        },
      }),
    });
    await expect(
      legacy.service.issueForFormerGuardian(GUARDIAN, DEPENDENT),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('AdultClaimIssueService.issueForDirector', () => {
  it('issues for a custody-origin person in the section, stamping the section', async () => {
    const ctx = setup({
      released: [{ is_custodian: true, guardian_user_id: null }],
    });
    await ctx.service.issueForDirector('dir-1', 7, DEPENDENT);
    expect(ctx.linkCodes.issueAdultClaimCode).toHaveBeenCalledWith({
      dependentId: DEPENDENT,
      issuedBy: 'dir-1',
      clubSectionId: 7,
    });
    expect(ctx.audit.recordEventOrThrow.mock.calls[0][0].changes).toMatchObject(
      {
        issuer: 'director',
      },
    );
  });

  it('issues when the person has no former guardian user at all', async () => {
    const ctx = setup({ released: [] });
    await expect(
      ctx.service.issueForDirector('dir-1', 7, DEPENDENT),
    ).resolves.toBeDefined();
  });

  it('404 when the person is not a live member of that section', async () => {
    const ctx = setup({ live: null });
    await expect(
      ctx.service.issueForDirector('dir-1', 7, DEPENDENT),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('404 when a family (former guardian user) holds the code path and there was no custody', async () => {
    const ctx = setup({
      released: [{ is_custodian: false, guardian_user_id: GUARDIAN }],
    });
    await expect(
      ctx.service.issueForDirector('dir-1', 7, DEPENDENT),
    ).rejects.toMatchObject({ code: ErrorCode.GUARDIANSHIP_NOT_FOUND });
    expect(ctx.linkCodes.issueAdultClaimCode).not.toHaveBeenCalled();
  });
});
