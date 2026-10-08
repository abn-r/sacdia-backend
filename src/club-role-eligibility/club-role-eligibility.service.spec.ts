import { investiture_status_enum } from '@prisma/client';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ClubRoleEligibilityService } from './club-role-eligibility.service';

const userId = '00000000-0000-0000-0000-000000000001';
const otherUserId = '00000000-0000-0000-0000-000000000002';
const findMany = jest.fn();
const findUnique = jest.fn();
const rolesFindMany = jest.fn();
const service = new ClubRoleEligibilityService({
  enrollments: { findMany },
  club_sections: { findUnique },
  roles: { findMany: rolesFindMany },
} as never);

const row = (
  status: investiture_status_enum,
  enrollmentId = 11,
  user = userId,
) => ({
  enrollment_id: enrollmentId,
  user_id: user,
  investiture_status: status,
});

const sectionOf = (name: string | null) =>
  findUnique.mockResolvedValue({ club_types: name ? { name } : null });

const activeStatuses = [
  investiture_status_enum.IN_PROGRESS,
  investiture_status_enum.SUBMITTED_FOR_VALIDATION,
  investiture_status_enum.CLUB_APPROVED,
  investiture_status_enum.COORDINATOR_APPROVED,
  investiture_status_enum.FIELD_APPROVED,
];

describe('ClubRoleEligibilityService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('evaluateGuideMajor', () => {
    it.each(activeStatuses)('eligible with active enrollment %s', async (s) => {
      findMany.mockResolvedValue([row(s)]);
      await expect(service.evaluateGuideMajor(userId)).resolves.toEqual({
        eligible: true,
        basis: 'ACTIVE_ENROLLMENT',
        enrollmentId: 11,
      });
    });

    it('eligible when APPROVED (any year)', async () => {
      findMany.mockResolvedValue([row(investiture_status_enum.APPROVED)]);
      await expect(service.evaluateGuideMajor(userId)).resolves.toMatchObject({
        eligible: true,
        basis: 'APPROVED',
      });
    });

    it('eligible when INVESTIDO and prefers INVESTED basis', async () => {
      findMany.mockResolvedValue([
        row(investiture_status_enum.IN_PROGRESS, 1),
        row(investiture_status_enum.INVESTIDO, 2),
      ]);
      await expect(service.evaluateGuideMajor(userId)).resolves.toEqual({
        eligible: true,
        basis: 'INVESTED',
        enrollmentId: 2,
      });
    });

    it('queries GM-01 by asset_code and excludes REJECTED/EXPIRED', async () => {
      findMany.mockResolvedValue([]);
      await expect(service.evaluateGuideMajor(userId)).resolves.toEqual({
        eligible: false,
        basis: null,
        enrollmentId: null,
      });
      const where = findMany.mock.calls[0][0].where;
      expect(where.classes).toEqual({ asset_code: 'GM-01' });
      const flat = JSON.stringify(where);
      expect(flat).not.toContain('REJECTED');
      expect(flat).not.toContain('EXPIRED');
      expect(flat).toContain('APPROVED');
      expect(flat).toContain('INVESTIDO');
    });

    it('keeps counting legacy APPROVED and the open chain statuses (phase 8)', async () => {
      findMany.mockResolvedValue([]);
      await service.evaluateGuideMajor(userId);
      const where = findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        {
          investiture_status: {
            in: [
              investiture_status_enum.INVESTIDO,
              investiture_status_enum.APPROVED,
            ],
          },
        },
        {
          active: true,
          investiture_status: {
            in: [
              investiture_status_enum.IN_PROGRESS,
              investiture_status_enum.SUBMITTED_FOR_VALIDATION,
              investiture_status_enum.CLUB_APPROVED,
              investiture_status_enum.COORDINATOR_APPROVED,
              investiture_status_enum.FIELD_APPROVED,
            ],
          },
          classes: { asset_code: 'GM-01', active: true },
        },
      ]);
    });
  });

  describe('evaluateMany', () => {
    it('resolves a batch with one query and defaults to not eligible', async () => {
      findMany.mockResolvedValue([
        row(investiture_status_enum.APPROVED, 5, otherUserId),
      ]);
      const result = await service.evaluateMany([
        userId,
        otherUserId,
        otherUserId,
      ]);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(result.get(userId)?.eligible).toBe(false);
      expect(result.get(otherUserId)).toMatchObject({
        eligible: true,
        basis: 'APPROVED',
      });
    });

    it('skips the query for an empty list', async () => {
      const result = await service.evaluateMany([]);
      expect(result.size).toBe(0);
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe('assignment matrix', () => {
    const eligible = () =>
      findMany.mockResolvedValue([row(investiture_status_enum.INVESTIDO)]);
    const notEligible = () => findMany.mockResolvedValue([]);
    const assignment = (roleName: string, clubSectionId = 7) =>
      service.evaluateAssignment({ userId, roleName, clubSectionId });

    it.each(['Aventureros', 'Conquistadores', 'Guías Mayores', 'Otro'])(
      'rule 1: not eligible service role is rejected in %s',
      async (type) => {
        notEligible();
        sectionOf(type);
        await expect(assignment('director')).resolves.toMatchObject({
          allowed: false,
          violation: {
            rule: 'RULE_1_MEMBER_ONLY',
            code: ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED,
          },
        });
      },
    );

    it.each(['Aventureros', 'Conquistadores', 'Guías Mayores', 'Otro'])(
      'not eligible member is allowed in %s',
      async (type) => {
        notEligible();
        sectionOf(type);
        await expect(assignment('member')).resolves.toMatchObject({
          allowed: true,
          violation: null,
        });
      },
    );

    it.each([
      ['Aventureros', 'AV'],
      ['Conquistadores', 'CQ'],
    ])('rule 3: eligible member rejected in %s', async (type, kind) => {
      eligible();
      sectionOf(type);
      await expect(assignment('member')).resolves.toMatchObject({
        allowed: false,
        sectionKind: kind,
        violation: {
          rule: 'RULE_3_GM_MEMBER_IN_AV_CQ',
          code: ErrorCode.CLUB_ROLE_MEMBER_REQUIRES_GUIDE_MAJOR_SECTION,
        },
      });
    });

    it('rule 2: eligible member allowed in GM section', async () => {
      eligible();
      sectionOf('Guías Mayores');
      await expect(assignment('member')).resolves.toMatchObject({
        allowed: true,
        sectionKind: 'GM',
      });
    });

    it.each(['Aventureros', 'Conquistadores', 'Guías Mayores', 'Otro'])(
      'eligible service role allowed in %s',
      async (type) => {
        eligible();
        sectionOf(type);
        await expect(assignment('counselor')).resolves.toMatchObject({
          allowed: true,
        });
      },
    );

    it('UNKNOWN section: rule 3 skipped, rule 1 still applies', async () => {
      eligible();
      sectionOf('Otro');
      await expect(assignment('member')).resolves.toMatchObject({
        allowed: true,
        sectionKind: 'UNKNOWN',
      });
    });

    it('GM precedence over cross-type enrollment (only GM-01 queried)', async () => {
      eligible();
      sectionOf('Conquistadores');
      const result = await assignment('member');
      expect(result.eligible).toBe(true);
      expect(findMany.mock.calls[0][0].where.classes).toEqual({
        asset_code: 'GM-01',
      });
    });

    it('missing section throws not found', async () => {
      notEligible();
      findUnique.mockResolvedValue(null);
      await expect(assignment('member')).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
    });

    it('evaluateAssignmentForKind needs no section lookup', async () => {
      eligible();
      await expect(
        service.evaluateAssignmentForKind({
          userId,
          roleName: 'member',
          sectionKind: 'CQ',
        }),
      ).resolves.toMatchObject({ allowed: false });
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('assertAssignment throws 403 with the rule code', async () => {
      eligible();
      sectionOf('Aventureros');
      const promise = service.assertAssignment({
        userId,
        roleName: 'member',
        clubSectionId: 7,
      });
      await expect(promise).rejects.toBeInstanceOf(AppForbiddenException);
      await expect(promise).rejects.toMatchObject({
        code: ErrorCode.CLUB_ROLE_MEMBER_REQUIRES_GUIDE_MAJOR_SECTION,
      });
    });

    it('assertAssignment returns the result when allowed', async () => {
      notEligible();
      sectionOf('Aventureros');
      await expect(
        service.assertAssignment({
          userId,
          roleName: 'member',
          clubSectionId: 7,
        }),
      ).resolves.toMatchObject({ allowed: true });
    });
  });

  describe('listAssignableRoles', () => {
    const catalog = [
      { role_id: 'r1', role_name: 'director' },
      { role_id: 'r2', role_name: 'member' },
      { role_id: 'r3', role_name: 'counselor' },
    ];

    it('not eligible: member only', async () => {
      findMany.mockResolvedValue([]);
      sectionOf('Conquistadores');
      rolesFindMany.mockResolvedValue(catalog);
      await expect(
        service.listAssignableRoles({ userId, clubSectionId: 7 }),
      ).resolves.toEqual({
        guide_major_eligible: false,
        section_kind: 'CQ',
        roles: [
          {
            role_id: 'r1',
            role_name: 'director',
            allowed: false,
            violation_rule: 'RULE_1_MEMBER_ONLY',
            violation_code: ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED,
          },
          {
            role_id: 'r2',
            role_name: 'member',
            allowed: true,
            violation_rule: null,
            violation_code: null,
          },
          {
            role_id: 'r3',
            role_name: 'counselor',
            allowed: false,
            violation_rule: 'RULE_1_MEMBER_ONLY',
            violation_code: ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED,
          },
        ],
      });
    });

    it('eligible in AV/CQ: service roles only', async () => {
      findMany.mockResolvedValue([row(investiture_status_enum.APPROVED)]);
      sectionOf('Aventureros');
      rolesFindMany.mockResolvedValue(catalog);
      const result = await service.listAssignableRoles({
        userId,
        clubSectionId: 7,
      });
      expect(result.guide_major_eligible).toBe(true);
      expect(
        result.roles.filter((r) => r.allowed).map((r) => r.role_name),
      ).toEqual(['director', 'counselor']);
      expect(result.roles.find((r) => r.role_name === 'member')).toMatchObject({
        allowed: false,
        violation_code: ErrorCode.CLUB_ROLE_MEMBER_REQUIRES_GUIDE_MAJOR_SECTION,
      });
    });

    it('eligible in GM: member plus service roles', async () => {
      findMany.mockResolvedValue([row(investiture_status_enum.INVESTIDO)]);
      sectionOf('Guías Mayores');
      rolesFindMany.mockResolvedValue(catalog);
      const result = await service.listAssignableRoles({
        userId,
        clubSectionId: 7,
      });
      expect(result.roles.every((r) => r.allowed)).toBe(true);
      expect(result.section_kind).toBe('GM');
    });
  });
});
