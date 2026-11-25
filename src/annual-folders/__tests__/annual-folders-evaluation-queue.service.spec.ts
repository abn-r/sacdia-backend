import { Test, TestingModule } from '@nestjs/testing';
import { annual_folder_section_status_enum } from '@prisma/client';
import { AnnualFoldersService } from '../annual-folders.service';
import { AuthorizationContextService } from '../../common/services/authorization-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';
import { GlobalRole } from '../../common/authorization/roles';
import { ErrorCode } from '../../common/errors/error-codes';
import { buildResolvedProfile } from './folder-scope.testing';

describe('AnnualFoldersService — getEvaluationQueue', () => {
  let service: AnnualFoldersService;

  const mockPrismaService = {
    annual_folders: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    users_roles: {
      findFirst: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(),
  };

  const mockAuthorizationContext = {
    resolveUserAuthorization: jest.fn(),
    canAccessHierarchyScope: jest.fn(),
  };

  const actAs = (roleName: string | null, ids = {}) => {
    mockAuthorizationContext.resolveUserAuthorization.mockResolvedValue(
      buildResolvedProfile(roleName, ids),
    );
  };

  const submittedAt = new Date('2026-06-15T14:30:00Z');
  const mockFolder = {
    annual_folder_id: '11111111-1111-4111-8111-111111111111',
    status: 'under_evaluation',
    created_at: new Date('2026-06-01T10:00:00Z'),
    modified_at: new Date('2026-06-16T10:00:00Z'),
    _count: { evidences: 7 },
    club_enrollment: {
      club_enrollment_id: '22222222-2222-4222-8222-222222222222',
      club_section_id: 45,
      ecclesiastical_year_id: 2026,
      status: 'active',
      club_section: {
        club_section_id: 45,
        name: 'Conquistadores Betel',
        club_types: { name: 'Conquistadores' },
        clubs: {
          club_id: 12,
          name: 'Club Betel',
          local_fields: {
            local_field_id: 5,
            name: 'Asociación Central Venezolana',
            unions: {
              union_id: 2,
              name: 'Unión Venezolana Oriental',
            },
          },
        },
      },
      ecclesiastical_year: {
        year_id: 2026,
        start_date: new Date('2025-07-01T00:00:00Z'),
        end_date: new Date('2026-06-30T00:00:00Z'),
      },
    },
    folder_template: {
      folder_template_id: '33333333-3333-4333-8333-333333333333',
      name: 'Carpeta Anual Conquistadores',
      club_type: { name: 'Conquistadores' },
      ecclesiastical_year: {
        start_date: new Date('2025-07-01T00:00:00Z'),
        end_date: new Date('2026-06-30T00:00:00Z'),
      },
      sections: [{ section_id: 'section-a' }, { section_id: 'section-b' }],
    },
    evaluations: [
      {
        status: annual_folder_section_status_enum.SUBMITTED,
        section_id: 'section-a',
        section: { name: 'Administración' },
      },
      {
        status: annual_folder_section_status_enum.PREAPPROVED_LF,
        section_id: 'section-b',
        section: { name: 'Evangelismo' },
      },
      {
        status: annual_folder_section_status_enum.VALIDATED,
        section_id: 'section-c',
        section: { name: 'Finanzas' },
      },
    ],
    section_submissions: [
      {
        section_id: 'section-b',
        submitted_at: submittedAt,
      },
    ],
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualFoldersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContext,
        },
      ],
    }).compile();

    service = module.get<AnnualFoldersService>(AnnualFoldersService);
    mockPrismaService.annual_folders.findMany.mockResolvedValue([mockFolder]);
    mockPrismaService.annual_folders.count.mockResolvedValue(1);
  });

  it('returns a human-readable queue item without requiring the operator to know a UUID', async () => {
    mockPrismaService.users_roles.findFirst.mockResolvedValue({
      user_role_id: 'super-admin-role',
    });

    const result = await service.getEvaluationQueue('reviewer-1', {
      page: 0,
      limit: 500,
    });

    expect(result.page).toBe(1);
    expect(result.limit).toBe(100);
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      annual_folder_id: mockFolder.annual_folder_id,
      display_name: 'Club Betel · Conquistadores Betel · 2025-2026',
      club_name: 'Club Betel',
      club_section_name: 'Conquistadores Betel',
      local_field_name: 'Asociación Central Venezolana',
      union_name: 'Unión Venezolana Oriental',
      template_name: 'Carpeta Anual Conquistadores',
      year_label: '2025-2026',
      total_sections: 2,
      total_evidences: 7,
      submitted_sections_count: 1,
      preapproved_sections_count: 1,
      validated_sections_count: 1,
      pending_section_names: ['Administración', 'Evangelismo'],
      latest_submitted_at: submittedAt,
    });
  });

  const queueWhere = () =>
    mockPrismaService.annual_folders.findMany.mock.calls[0][0].where;

  const territorialBranch = (clubsWhere: object) => ({
    club_enrollment: { club_section: { clubs: clubsWhere } },
  });

  it('keeps access scope, status filter, and search filter composed under AND', async () => {
    mockPrismaService.users_roles.findFirst.mockResolvedValue(null);
    actAs(GlobalRole.DIRECTOR_UNION, { union: 2, division: 1 });

    await service.getEvaluationQueue('reviewer-1', {
      search: 'Betel',
      status: 'needs_review',
    });

    const where = queueWhere();
    expect(where.AND).toHaveLength(3);
    expect(where.AND[0].OR).toEqual(
      expect.arrayContaining([
        territorialBranch({ local_fields: { union_id: 2 } }),
      ]),
    );
    expect(where.AND[1]).toEqual({
      evaluations: {
        some: {
          status: {
            in: [
              annual_folder_section_status_enum.SUBMITTED,
              annual_folder_section_status_enum.PREAPPROVED_LF,
            ],
          },
        },
      },
    });
    expect(where.AND[2].OR).toEqual(expect.any(Array));
  });

  describe('territorial scope through the hierarchy', () => {
    beforeEach(() => {
      mockPrismaService.users_roles.findFirst.mockResolvedValue(null);
    });

    it('Division actor sees every union of its division, not its own users.union_id', async () => {
      actAs(GlobalRole.DIRECTOR_DIA, { division: 7, union: 99 });

      await service.getEvaluationQueue('reviewer-1', {});

      const branches = queueWhere().AND[0].OR;
      expect(branches).toHaveLength(2);
      expect(branches).toContainEqual(
        territorialBranch({ local_fields: { unions: { division_id: 7 } } }),
      );
      expect(JSON.stringify(branches)).not.toContain('"union_id":99');
      expect(mockPrismaService.users.findUnique).not.toHaveBeenCalled();
    });

    it('Division actor anchored only by local_field_id is still cut by its division', async () => {
      actAs(GlobalRole.ASSISTANT_DIA, { division: 7, localField: 5 });

      await service.getEvaluationQueue('reviewer-1', {});

      const branches = queueWhere().AND[0].OR;
      expect(branches).toContainEqual(
        territorialBranch({ local_fields: { unions: { division_id: 7 } } }),
      );
      expect(JSON.stringify(branches)).not.toContain('"local_field_id":5');
    });

    it('Union actor keeps the union cut', async () => {
      actAs(GlobalRole.ASSISTANT_UNION, { union: 2 });

      await service.getEvaluationQueue('reviewer-1', {});

      expect(queueWhere().AND[0].OR).toContainEqual(
        territorialBranch({ local_fields: { union_id: 2 } }),
      );
    });

    it('Local field actor keeps the local field cut', async () => {
      actAs(GlobalRole.DIRECTOR_LF, { localField: 5, union: 2 });

      await service.getEvaluationQueue('reviewer-1', {});

      const branches = queueWhere().AND[0].OR;
      expect(branches).toContainEqual(territorialBranch({ local_field_id: 5 }));
      expect(JSON.stringify(branches)).not.toContain('union_id');
    });

    it('actor without a territorial role only gets the club-assignment branch', async () => {
      actAs(null);

      await service.getEvaluationQueue('reviewer-1', {});

      expect(queueWhere().AND[0].OR).toHaveLength(1);
    });

    it('Division role without a division anchor answers 403 ADMIN_USER_SCOPE_MISSING', async () => {
      actAs(GlobalRole.DIRECTOR_DIA, { localField: 5 });

      await expect(
        service.getEvaluationQueue('reviewer-1', {}),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
      expect(mockPrismaService.annual_folders.findMany).not.toHaveBeenCalled();
    });
  });

  it('escapes LIKE wildcards in every search predicate', async () => {
    mockPrismaService.users_roles.findFirst.mockResolvedValue({
      user_role_id: 'super-admin-role',
    });

    await service.getEvaluationQueue('reviewer-1', {
      search: ' 50%_off ',
      status: 'needs_review',
    });

    const where =
      mockPrismaService.annual_folders.findMany.mock.calls[0][0].where;
    const searchWhere = where.AND[where.AND.length - 1];
    const contained: unknown[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'contains') contained.push(value);
          else walk(value);
        }
      }
    };
    walk(searchWhere);

    expect(contained).toHaveLength(6);
    expect(new Set(contained)).toEqual(new Set(['50\\%\\_off']));
  });
});
