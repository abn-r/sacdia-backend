import { Test, TestingModule } from '@nestjs/testing';
import { annual_folder_section_status_enum } from '@prisma/client';
import { AnnualFoldersService } from '../annual-folders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';

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

  it('keeps access scope, status filter, and search filter composed under AND', async () => {
    mockPrismaService.users_roles.findFirst.mockResolvedValue(null);
    mockPrismaService.users.findUnique.mockResolvedValue({
      local_field_id: 5,
      union_id: 2,
    });

    await service.getEvaluationQueue('reviewer-1', {
      search: 'Betel',
      status: 'needs_review',
    });

    const where =
      mockPrismaService.annual_folders.findMany.mock.calls[0][0].where;
    expect(where.AND).toHaveLength(3);
    expect(where.AND[0].OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          club_enrollment: expect.objectContaining({
            club_section: expect.objectContaining({
              clubs: expect.objectContaining({ local_field_id: 5 }),
            }),
          }),
        }),
        expect.objectContaining({
          club_enrollment: expect.objectContaining({
            club_section: expect.objectContaining({
              clubs: expect.objectContaining({
                local_fields: expect.objectContaining({ union_id: 2 }),
              }),
            }),
          }),
        }),
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
});
