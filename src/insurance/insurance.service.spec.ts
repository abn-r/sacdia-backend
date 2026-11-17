import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { memberInLocalFieldWhere } from '../common/authorization/actor-territory-scope';
import { effectiveAssignmentAt } from '../common/testing/effective-assignment.testing';
import { MemberTerritoryScopeService } from '../common/authorization/member-territory-scope.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CoordinationService } from '../coordination/coordination.service';
import { PrismaService } from '../prisma/prisma.service';
import { InsuranceService } from './insurance.service';

describe('InsuranceService', () => {
  let service: InsuranceService;

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
  };

  const mockCoordinationService = {
    getEffectiveCoordinatorSectionIds: jest.fn(),
  };

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
    },
    club_role_assignments: {
      findMany: jest.fn(),
    },
    club_sections: {
      findFirst: jest.fn(),
    },
    member_insurances: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    insurance_assignments: {
      findFirst: jest.fn(),
    },
  };

  const EFFECTIVE = effectiveAssignmentAt(new Date('2026-10-28T12:00:00.000Z'));
  const mockMemberScope = {
    effectiveAssignmentForLocalField: jest.fn(async () => EFFECTIVE),
    resolveMemberLocalFieldIds: jest.fn(),
  };

  const mockFileStorageService = {
    upload: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    extractKeyFromPublicUrl: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InsuranceService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: FILE_STORAGE_SERVICE,
          useValue: mockFileStorageService,
        },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContext,
        },
        {
          provide: CoordinationService,
          useValue: mockCoordinationService,
        },
        { provide: MemberTerritoryScopeService, useValue: mockMemberScope },
      ],
    }).compile();

    service = module.get(InsuranceService);
    mockMemberScope.resolveMemberLocalFieldIds.mockResolvedValue([]);

    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    mockFileStorageService.getSignedDownloadUrl.mockImplementation(
      async (_bucket: unknown, value: string) => `${value}?signed=true`,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('lists members in the section with their latest active insurance and current class', async () => {
    mockPrismaService.club_sections.findFirst.mockResolvedValue({
      club_section_id: 21,
    });
    mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
      {
        user_id: 'member-1',
        users: {
          user_id: 'member-1',
          name: 'Juan',
          paternal_last_name: 'García',
          maternal_last_name: 'López',
          user_image: 'user-profiles/member-1.jpg',
          enrollments: [
            {
              ecclesiastical_year_id: 2025,
              classes: { name: 'Explorador' },
            },
          ],
        },
      },
    ]);

    mockPrismaService.member_insurances.findFirst.mockResolvedValue({
      insurance_id: 11,
      user_id: 'member-1',
      insurance_type: 'GENERAL_ACTIVITIES',
      policy_number: 'POL-001',
      provider: 'Seguros SACDIA',
      start_date: new Date('2025-01-01'),
      end_date: new Date('2025-12-31'),
      coverage_amount: 500,
      active: true,
      evidence_file_url: 'evidence/member-1.pdf',
      evidence_file_name: 'comprobante.pdf',
      created_at: new Date('2025-01-10T12:00:00.000Z'),
      modified_at: new Date('2025-01-12T12:00:00.000Z'),
      created_by: { name: 'Director Juan' },
      modified_by: null,
    });

    const result = await service.listMembersInsurance(9, 21);

    expect(
      mockPrismaService.club_role_assignments.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          club_section_id: 21,
          active: true,
          club_sections: { main_club_id: 9 },
        },
        select: expect.objectContaining({
          users: expect.objectContaining({
            select: expect.objectContaining({
              enrollments: expect.objectContaining({
                where: {
                  active: true,
                  record_kind: 'OPERATIONAL',
                },
              }),
            }),
          }),
        }),
      }),
    );
    expect(mockPrismaService.member_insurances.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'member-1', active: true },
      }),
    );
    expect(mockFileStorageService.getSignedDownloadUrl).toHaveBeenCalledWith(
      expect.anything(),
      'user-profiles/member-1.jpg',
      expect.anything(),
    );
    expect(result).toEqual([
      {
        user_id: 'member-1',
        name: 'Juan',
        paternal_last_name: 'García',
        maternal_last_name: 'López',
        user_image: 'user-profiles/member-1.jpg?signed=true',
        current_class: { name: 'Explorador' },
        insurance: {
          insurance_id: 11,
          insurance_type: 'GENERAL_ACTIVITIES',
          policy_number: 'POL-001',
          provider: 'Seguros SACDIA',
          start_date: new Date('2025-01-01'),
          end_date: new Date('2025-12-31'),
          coverage_amount: 500,
          active: true,
          evidence_file_url: 'evidence/member-1.pdf?signed=true',
          evidence_file_name: 'comprobante.pdf',
          created_at: new Date('2025-01-10T12:00:00.000Z'),
          modified_at: new Date('2025-01-12T12:00:00.000Z'),
          created_by_name: 'Director Juan',
          modified_by_name: null,
        },
      },
    ]);
  });

  it('normalizes legacy evidence URLs to R2 keys and never returns a raw URL fallback', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'member-legacy',
      name: 'Ana',
      paternal_last_name: 'Pérez',
      maternal_last_name: null,
      user_image: null,
      enrollments: [],
    });
    mockPrismaService.member_insurances.findFirst.mockResolvedValue({
      insurance_id: 13,
      user_id: 'member-legacy',
      active: true,
      evidence_file_url: 'https://legacy.example/private/proof.pdf',
      evidence_file_name: 'proof.pdf',
    });
    mockFileStorageService.extractKeyFromPublicUrl.mockReturnValue(null);

    const result = await service.getMemberInsurance('member-legacy');

    expect(result.insurance.evidence_file_url).toBeNull();
    expect(
      mockFileStorageService.getSignedDownloadUrl,
    ).not.toHaveBeenCalledWith(
      expect.anything(),
      'https://legacy.example/private/proof.pdf',
      expect.anything(),
    );
  });

  it('rejects list requests when the section does not belong to the club', async () => {
    mockPrismaService.club_sections.findFirst.mockResolvedValue(null);

    await expect(service.listMembersInsurance(9, 21)).rejects.toMatchObject({
      code: ErrorCode.CLUB_SECTION_NOT_FOUND,
    });

    expect(mockPrismaService.club_sections.findFirst).toHaveBeenCalledWith({
      where: { club_section_id: 21, main_club_id: 9 },
      select: { club_section_id: true },
    });
    expect(
      mockPrismaService.club_role_assignments.findMany,
    ).not.toHaveBeenCalled();
  });

  it('returns member insurance detail with null insurance when no active insurance exists', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'member-2',
      name: 'Ana',
      paternal_last_name: 'Pérez',
      maternal_last_name: null,
      user_image: 'user-profiles/member-2.jpg',
      enrollments: [
        {
          ecclesiastical_year_id: 2025,
          classes: { name: 'Explorador' },
        },
      ],
    });
    mockPrismaService.member_insurances.findFirst.mockResolvedValue(null);

    const result = await service.getMemberInsurance('member-2');

    expect(mockPrismaService.users.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'member-2' },
      }),
    );
    expect(result).toEqual({
      user_id: 'member-2',
      user: {
        user_id: 'member-2',
        name: 'Ana',
        paternal_last_name: 'Pérez',
        maternal_last_name: null,
        user_image: 'user-profiles/member-2.jpg?signed=true',
        current_class: { name: 'Explorador' },
      },
      current_class: { name: 'Explorador' },
      insurance: null,
      coverage_source: 'legacy',
      active_assignment: null,
    });
  });

  it('marks coverage as capacity_model when an active assignment exists', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'member-2',
      name: 'Ana',
      paternal_last_name: 'Pérez',
      maternal_last_name: null,
      user_image: null,
      enrollments: [],
    });
    mockPrismaService.member_insurances.findFirst.mockResolvedValue(null);
    mockPrismaService.insurance_assignments.findFirst.mockResolvedValue({
      insurance_assignment_id: 55,
      valid_from: new Date('2026-01-01'),
      valid_until: new Date('2027-01-01'),
    });

    const result = await service.getMemberInsurance('member-2');

    expect(result.coverage_source).toBe('capacity_model');
    expect(result.active_assignment).toMatchObject({
      insurance_assignment_id: 55,
    });
  });

  it('always rejects manual insurance creation (legacy retired), regardless of the flag', async () => {
    await expect(
      service.createInsurance(
        'member-9',
        { insurance_type: 'GENERAL_ACTIVITIES' },
        undefined,
        'admin-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_LEGACY_DISABLED,
    });
    expect(mockPrismaService.member_insurances.create).not.toHaveBeenCalled();
    expect(mockFileStorageService.upload).not.toHaveBeenCalled();
  });

  it('always rejects manual insurance updates (legacy retired)', async () => {
    await expect(
      service.updateInsurance(
        42,
        { policy_number: 'POL-1' },
        undefined,
        'admin-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.FIELD_PAYMENT_ORDER_LEGACY_DISABLED,
    });
    expect(mockPrismaService.member_insurances.update).not.toHaveBeenCalled();
  });

  it('throws when member does not exist', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue(null);

    await expect(
      service.getMemberInsurance('missing-member'),
    ).rejects.toMatchObject({ code: ErrorCode.INSURANCE_MEMBER_NOT_FOUND });
  });

  describe('getExpiringInsurances', () => {
    function authProfile(roles: string[], localFieldId?: number) {
      return {
        authorization: {
          grants: {
            global_roles: roles.map((role_name) => ({ role_name })),
          },
          effective: {
            scope: {
              global:
                localFieldId != null
                  ? { local_field: { id: localFieldId } }
                  : {},
            },
          },
        },
      };
    }

    beforeEach(() => {
      mockPrismaService.member_insurances.findMany.mockResolvedValue([]);
    });

    it('scopes director-lf to the actor local field', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        authProfile(['director-lf'], 7),
      );

      await service.getExpiringInsurances('lf-1', 30);

      expect(mockPrismaService.member_insurances.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            users: memberInLocalFieldWhere(7, EFFECTIVE),
          }),
        }),
      );
    });

    it('rejects a field filter outside the actor local field', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        authProfile(['assistant-lf'], 7),
      );

      await expect(
        service.getExpiringInsurances('lf-1', 30, 99),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    });

    it('rejects director-lf without local_field scope', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        authProfile(['director-lf']),
      );

      await expect(
        service.getExpiringInsurances('lf-1', 30),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });

    it('scopes coordinators to assigned sections', async () => {
      mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
        authProfile(['coordinator']),
      );
      mockCoordinationService.getEffectiveCoordinatorSectionIds.mockResolvedValue(
        [21, 22],
      );

      await service.getExpiringInsurances('coord-1', 30);

      expect(mockPrismaService.member_insurances.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            users: {
              club_role_assignments: {
                some: {
                  club_section_id: { in: [21, 22] },
                  active: true,
                },
              },
            },
          }),
        }),
      );
    });
  });
});
