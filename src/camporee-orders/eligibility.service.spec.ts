import { ErrorCode } from '../common/errors/error-codes';
import type { ActorTerritoryScope } from '../common/authorization/actor-territory-scope';
import type { CamporeeOrderActor } from './camporee-order-actor';
import { EligibilityService } from './eligibility.service';

const LF_10 = 10;
const SECTION_11 = 11;
const SECTION_12 = 12;
const LOCAL_CAMPOREE_ID = 21;
const UNION_CAMPOREE_ID = 22;
const OTHER_CAMPOREE_ID = 99;
const MEMBER_ID = 801;
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DIRECTOR_ID = '33333333-3333-4333-8333-333333333333';

function baseActor(
  overrides: Partial<CamporeeOrderActor> & {
    territory: ActorTerritoryScope;
  },
): CamporeeOrderActor {
  return {
    userId: DIRECTOR_ID,
    sectionIds: [SECTION_11],
    globalAccess: false,
    canReview: false,
    globalRoles: [],
    ...overrides,
  };
}

function clubActor(sectionId = SECTION_11): CamporeeOrderActor {
  return baseActor({
    localFieldId: LF_10,
    sectionIds: [sectionId],
    territory: { level: 'open' },
    activeSection: {
      club_section_id: sectionId,
      club_id: 5,
      club_name: 'Club Orión',
      club_type_id: 1,
      role_name: 'director',
      local_field_id: LF_10,
    },
  });
}

function eligibleMember(overrides: Record<string, unknown> = {}) {
  return {
    camporee_member_id: MEMBER_ID,
    user_id: USER_ID,
    active: true,
    status: 'approved',
    camporee_id: LOCAL_CAMPOREE_ID,
    union_camporee_id: null,
    camporee_club: {
      club_section_id: SECTION_11,
      active: true,
      status: 'approved',
    },
    users: {
      name: 'Ana',
      paternal_last_name: 'García',
      maternal_last_name: 'López',
    },
    ...overrides,
  };
}

describe('EligibilityService', () => {
  let prisma: any;
  let service: EligibilityService;

  beforeEach(() => {
    prisma = {
      camporee_members: { findMany: jest.fn() },
      camporee_clubs: { findFirst: jest.fn() },
      union_camporee_local_fields: { findFirst: jest.fn() },
      users: { findUnique: jest.fn(), findMany: jest.fn() },
    };
    prisma.camporee_clubs.findFirst.mockResolvedValue({
      camporee_club_id: 44,
    });
    prisma.camporee_members.findMany.mockResolvedValue([eligibleMember()]);
    service = new EligibilityService(prisma);
  });

  async function assertLocal(
    overrides: {
      camporeeMemberId?: number | null;
      userId?: string;
      actor?: CamporeeOrderActor;
      camporeeId?: number;
    } = {},
  ) {
    return service.assertBeneficiaryEligible({
      camporeeMemberId:
        overrides.camporeeMemberId === undefined
          ? MEMBER_ID
          : overrides.camporeeMemberId,
      userId: overrides.userId,
      actor: overrides.actor ?? clubActor(),
      camporeeId: overrides.camporeeId ?? LOCAL_CAMPOREE_ID,
      kind: 'local',
    });
  }

  it('accepts an approved camporee_member of the same section and camporee', async () => {
    const result = await assertLocal();

    expect(result).toEqual({
      camporee_member_id: MEMBER_ID,
      user_id: USER_ID,
      beneficiary_name_snapshot: 'Ana García López',
    });
    expect(prisma.camporee_members.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { camporee_member_id: { in: [MEMBER_ID] } },
      }),
    );
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
    expect(prisma.users.findMany).not.toHaveBeenCalled();
  });

  it('accepts a registered camporee_member of the same section', async () => {
    prisma.camporee_members.findMany.mockResolvedValue([
      eligibleMember({ status: 'registered' }),
    ]);

    await expect(assertLocal()).resolves.toMatchObject({
      camporee_member_id: MEMBER_ID,
    });
  });

  it('rejects pending_approval members', async () => {
    prisma.camporee_members.findMany.mockResolvedValue([
      eligibleMember({ status: 'pending_approval' }),
    ]);

    await expect(assertLocal()).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
      status: 422,
    });
  });

  it('rejects rejected members', async () => {
    prisma.camporee_members.findMany.mockResolvedValue([
      eligibleMember({ status: 'rejected' }),
    ]);

    await expect(assertLocal()).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
    });
  });

  it('rejects inactive members', async () => {
    prisma.camporee_members.findMany.mockResolvedValue([
      eligibleMember({ active: false }),
    ]);

    await expect(assertLocal()).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
    });
  });

  it('rejects members of another section', async () => {
    prisma.camporee_members.findMany.mockResolvedValue([
      eligibleMember({
        camporee_club: {
          club_section_id: SECTION_12,
          active: true,
          status: 'approved',
        },
      }),
    ]);

    await expect(assertLocal()).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
    });
  });

  it('rejects members of another camporee', async () => {
    prisma.camporee_members.findMany.mockResolvedValue([
      eligibleMember({ camporee_id: OTHER_CAMPOREE_ID }),
    ]);

    await expect(assertLocal()).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
    });
  });

  it('rejects a free user_id used as authority without camporee_member_id', async () => {
    await expect(
      assertLocal({ camporeeMemberId: null, userId: USER_ID }),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
    });
    expect(prisma.camporee_members.findMany).not.toHaveBeenCalled();
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
  });

  it('accepts a union camporee when the section LF participates', async () => {
    prisma.union_camporee_local_fields.findFirst.mockResolvedValue({
      local_field_id: LF_10,
    });
    prisma.camporee_members.findMany.mockResolvedValue([
      eligibleMember({
        camporee_id: null,
        union_camporee_id: UNION_CAMPOREE_ID,
      }),
    ]);

    const result = await service.assertBeneficiaryEligible({
      camporeeMemberId: MEMBER_ID,
      actor: clubActor(),
      camporeeId: UNION_CAMPOREE_ID,
      kind: 'union',
    });

    expect(result.camporee_member_id).toBe(MEMBER_ID);
    expect(prisma.union_camporee_local_fields.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          union_camporee_lf_id: UNION_CAMPOREE_ID,
          local_field_id: LF_10,
          active: true,
        },
      }),
    );
  });

  it('rejects a union camporee when the section LF does not participate', async () => {
    prisma.union_camporee_local_fields.findFirst.mockResolvedValue(null);

    await expect(
      service.assertBeneficiaryEligible({
        camporeeMemberId: MEMBER_ID,
        actor: clubActor(),
        camporeeId: UNION_CAMPOREE_ID,
        kind: 'union',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_ORDER_MEMBER_NOT_ELIGIBLE,
    });
    expect(prisma.camporee_members.findMany).not.toHaveBeenCalled();
  });
});
