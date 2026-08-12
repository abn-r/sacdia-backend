import { Test, TestingModule } from '@nestjs/testing';
import { CertificationEligibilityService } from './certification-eligibility.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';

const USER_ID = 'user-uuid-001';
const VERSION_ID = 7;
const CERT_ID = 1;

const mockPrisma = {
  users: { findUnique: jest.fn() },
  certification_eligibility_rules: { findMany: jest.fn() },
  certification_versions: { findFirst: jest.fn() },
  enrollments: { findFirst: jest.fn() },
  club_role_assignments: { findFirst: jest.fn() },
};

describe('CertificationEligibilityService', () => {
  let service: CertificationEligibilityService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificationEligibilityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(CertificationEligibilityService);
  });

  describe('evaluateForVersion', () => {
    it('TC01 - throws USER_NOT_FOUND when the user does not exist', async () => {
      mockPrisma.users.findUnique.mockResolvedValue(null);

      await expect(
        service.evaluateForVersion(USER_ID, VERSION_ID),
      ).rejects.toMatchObject({ code: ErrorCode.USER_NOT_FOUND });
    });

    it('TC02 - zero configured rules → not eligible with NO_RULES_CONFIGURED', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: new Date('2000-01-01'),
        baptism: true,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([]);

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(result).toEqual({
        eligible: false,
        rules: [],
        reason_code: 'NO_RULES_CONFIGURED',
      });
    });

    it('TC03 - MIN_AGE satisfied when user is old enough', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: new Date('2000-06-15'),
        baptism: false,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 1,
          rule_type: 'MIN_AGE',
          configuration: { min_age: 16 },
          class_id: null,
          club_type_id: null,
          role_id: null,
          sort_order: 0,
        },
      ]);

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(result.eligible).toBe(true);
      expect(result.rules).toEqual([
        {
          eligibility_rule_id: 1,
          type: 'MIN_AGE',
          satisfied: true,
          reason_code: null,
        },
      ]);
    });

    it('TC04 - MIN_AGE not satisfied → AGE_TOO_LOW', async () => {
      const today = new Date();
      const tooYoungBirthday = new Date(
        today.getFullYear() - 10,
        today.getMonth(),
        today.getDate(),
      );
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: tooYoungBirthday,
        baptism: false,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 1,
          rule_type: 'MIN_AGE',
          configuration: { min_age: 16 },
          class_id: null,
          club_type_id: null,
          role_id: null,
          sort_order: 0,
        },
      ]);

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(result.eligible).toBe(false);
      expect(result.rules[0]).toMatchObject({
        type: 'MIN_AGE',
        satisfied: false,
        reason_code: 'AGE_TOO_LOW',
      });
    });

    it('TC05 - MIN_AGE with missing birthday → BIRTHDAY_MISSING', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: null,
        baptism: true,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 1,
          rule_type: 'MIN_AGE',
          configuration: { min_age: 16 },
          class_id: null,
          club_type_id: null,
          role_id: null,
          sort_order: 0,
        },
      ]);

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(result.eligible).toBe(false);
      expect(result.rules[0]).toMatchObject({
        satisfied: false,
        reason_code: 'BIRTHDAY_MISSING',
      });
    });

    it('TC06 - BAPTIZED satisfied/unsatisfied mirrors users.baptism', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: new Date('2000-01-01'),
        baptism: false,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 2,
          rule_type: 'BAPTIZED',
          configuration: {},
          class_id: null,
          club_type_id: null,
          role_id: null,
          sort_order: 0,
        },
      ]);

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(result.eligible).toBe(false);
      expect(result.rules[0]).toMatchObject({
        type: 'BAPTIZED',
        satisfied: false,
        reason_code: 'NOT_BAPTIZED',
      });
    });

    it('TC07 - INVESTED_CLASS matches strictly by class_id FK, never by classes.name', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: new Date('2000-01-01'),
        baptism: true,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 3,
          rule_type: 'INVESTED_CLASS',
          configuration: {},
          class_id: 42,
          club_type_id: null,
          role_id: null,
          sort_order: 0,
        },
      ]);
      // Even though the class is translated/renamed in the DB, the lookup
      // must go strictly through class_id — never `classes.name`.
      mockPrisma.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 99,
      });

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(mockPrisma.enrollments.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id: USER_ID,
            class_id: 42,
            investiture_status: 'INVESTIDO',
          },
        }),
      );
      // Assert the query shape never references classes.name
      const callArg = mockPrisma.enrollments.findFirst.mock.calls[0][0];
      expect(JSON.stringify(callArg)).not.toMatch(/classes/i);
      expect(result.eligible).toBe(true);
      expect(result.rules[0]).toMatchObject({
        type: 'INVESTED_CLASS',
        satisfied: true,
      });
    });

    it('TC08 - INVESTED_CLASS not satisfied → CLASS_NOT_INVESTED', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: new Date('2000-01-01'),
        baptism: true,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 3,
          rule_type: 'INVESTED_CLASS',
          configuration: {},
          class_id: 42,
          club_type_id: null,
          role_id: null,
          sort_order: 0,
        },
      ]);
      mockPrisma.enrollments.findFirst.mockResolvedValue(null);

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(result.eligible).toBe(false);
      expect(result.rules[0]).toMatchObject({
        satisfied: false,
        reason_code: 'CLASS_NOT_INVESTED',
      });
    });

    it('TC09 - ACTIVE_CLUB_TYPE checks an active club_role_assignment for that club_type_id', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: new Date('2000-01-01'),
        baptism: true,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 4,
          rule_type: 'ACTIVE_CLUB_TYPE',
          configuration: {},
          class_id: null,
          club_type_id: 2,
          role_id: null,
          sort_order: 0,
        },
      ]);
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-1',
      });

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(mockPrisma.club_role_assignments.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: USER_ID,
            active: true,
            status: 'active',
            club_sections: expect.objectContaining({
              active: true,
              club_type_id: 2,
            }),
          }),
        }),
      );
      expect(result.eligible).toBe(true);
    });

    it('TC10 - ACTIVE_CLUB_TYPE not satisfied → CLUB_TYPE_NOT_ACTIVE', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: new Date('2000-01-01'),
        baptism: true,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 4,
          rule_type: 'ACTIVE_CLUB_TYPE',
          configuration: {},
          class_id: null,
          club_type_id: 2,
          role_id: null,
          sort_order: 0,
        },
      ]);
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue(null);

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(result.eligible).toBe(false);
      expect(result.rules[0]).toMatchObject({
        satisfied: false,
        reason_code: 'CLUB_TYPE_NOT_ACTIVE',
      });
    });

    it('TC11 - ACTIVE_ROLE checks an active club_role_assignment for that role_id', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: new Date('2000-01-01'),
        baptism: true,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 5,
          rule_type: 'ACTIVE_ROLE',
          configuration: {},
          class_id: null,
          club_type_id: null,
          role_id: 'role-uuid',
          sort_order: 0,
        },
      ]);
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-2',
      });

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(mockPrisma.club_role_assignments.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: USER_ID,
            role_id: 'role-uuid',
            active: true,
            status: 'active',
          }),
        }),
      );
      expect(result.eligible).toBe(true);
    });

    it('TC12 - ACTIVE_ROLE not satisfied → ROLE_NOT_ACTIVE', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: new Date('2000-01-01'),
        baptism: true,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 5,
          rule_type: 'ACTIVE_ROLE',
          configuration: {},
          class_id: null,
          club_type_id: null,
          role_id: 'role-uuid',
          sort_order: 0,
        },
      ]);
      mockPrisma.club_role_assignments.findFirst.mockResolvedValue(null);

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(result.eligible).toBe(false);
      expect(result.rules[0]).toMatchObject({
        satisfied: false,
        reason_code: 'ROLE_NOT_ACTIVE',
      });
    });

    it('TC13 - evaluates ALL rules even when an earlier one fails (never short-circuits)', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: null,
        baptism: false,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 1,
          rule_type: 'MIN_AGE',
          configuration: { min_age: 16 },
          class_id: null,
          club_type_id: null,
          role_id: null,
          sort_order: 0,
        },
        {
          eligibility_rule_id: 2,
          rule_type: 'BAPTIZED',
          configuration: {},
          class_id: null,
          club_type_id: null,
          role_id: null,
          sort_order: 1,
        },
      ]);

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(result.eligible).toBe(false);
      expect(result.rules).toHaveLength(2);
      expect(result.rules[0].satisfied).toBe(false);
      expect(result.rules[1].satisfied).toBe(false);
    });

    it('TC14 - eligible=true only when every rule is satisfied', async () => {
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: new Date('1990-01-01'),
        baptism: true,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([
        {
          eligibility_rule_id: 1,
          rule_type: 'MIN_AGE',
          configuration: { min_age: 16 },
          class_id: null,
          club_type_id: null,
          role_id: null,
          sort_order: 0,
        },
        {
          eligibility_rule_id: 2,
          rule_type: 'BAPTIZED',
          configuration: {},
          class_id: null,
          club_type_id: null,
          role_id: null,
          sort_order: 1,
        },
      ]);

      const result = await service.evaluateForVersion(USER_ID, VERSION_ID);

      expect(result.eligible).toBe(true);
      expect(result.reason_code).toBeNull();
    });
  });

  describe('evaluateForCertification', () => {
    it('TC15 - returns null when no version is PUBLISHED', async () => {
      mockPrisma.certification_versions.findFirst.mockResolvedValue(null);

      const result = await service.evaluateForCertification(USER_ID, CERT_ID);

      expect(result).toBeNull();
    });

    it('TC16 - resolves the latest PUBLISHED version and evaluates it', async () => {
      mockPrisma.certification_versions.findFirst.mockResolvedValue({
        certification_version_id: VERSION_ID,
        status: 'PUBLISHED',
      });
      mockPrisma.users.findUnique.mockResolvedValue({
        user_id: USER_ID,
        birthday: new Date('1990-01-01'),
        baptism: true,
      });
      mockPrisma.certification_eligibility_rules.findMany.mockResolvedValue([]);

      const result = await service.evaluateForCertification(USER_ID, CERT_ID);

      expect(mockPrisma.certification_versions.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            certification_id: CERT_ID,
            status: 'PUBLISHED',
            active: true,
          }),
        }),
      );
      expect(result).toEqual({
        eligible: false,
        rules: [],
        reason_code: 'NO_RULES_CONFIGURED',
      });
    });
  });
});
