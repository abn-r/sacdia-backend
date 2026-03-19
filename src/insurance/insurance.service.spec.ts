import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { InsuranceService } from './insurance.service';

describe('InsuranceService', () => {
  let service: InsuranceService;

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
    },
    club_role_assignments: {
      findMany: jest.fn(),
    },
    member_insurances: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockFileStorageService = {
    upload: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
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
      ],
    }).compile();

    service = module.get(InsuranceService);

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
    mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
      {
        user_id: 'member-1',
        users: {
          user_id: 'member-1',
          name: 'Juan',
          paternal_last_name: 'García',
          maternal_last_name: 'López',
          user_image: 'user-profiles/member-1.jpg',
          users_classes: [
            {
              current_class: true,
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
        where: { club_section_id: 21, active: true },
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
          evidence_file_url: 'evidence/member-1.pdf',
          evidence_file_name: 'comprobante.pdf',
          created_at: new Date('2025-01-10T12:00:00.000Z'),
          modified_at: new Date('2025-01-12T12:00:00.000Z'),
          created_by_name: 'Director Juan',
          modified_by_name: null,
        },
      },
    ]);
  });

  it('returns member insurance detail with null insurance when no active insurance exists', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'member-2',
      name: 'Ana',
      paternal_last_name: 'Pérez',
      maternal_last_name: null,
      user_image: 'user-profiles/member-2.jpg',
      users_classes: [
        {
          current_class: true,
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
    });
  });

  it('creates insurance with evidence upload and stores audit fields', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'member-3',
      name: 'Luis',
      paternal_last_name: 'Ramírez',
      maternal_last_name: 'Sosa',
      user_image: null,
      users_classes: [],
    });
    mockPrismaService.member_insurances.create.mockResolvedValue({
      insurance_id: 12,
    });
    mockPrismaService.member_insurances.findFirst.mockResolvedValue({
      insurance_id: 12,
      user_id: 'member-3',
      insurance_type: 'CAMPOREE',
      policy_number: 'POL-123',
      provider: 'Seguros SACDIA',
      start_date: new Date('2025-02-01'),
      end_date: new Date('2025-12-31'),
      coverage_amount: 700,
      active: true,
      evidence_file_url: 'https://cdn.example.com/evidence/member-3.pdf',
      evidence_file_name: 'evidence.pdf',
      created_at: new Date('2025-02-01T12:00:00.000Z'),
      modified_at: new Date('2025-02-01T12:00:00.000Z'),
      created_by: { name: 'Admin User' },
      modified_by: null,
    });
    mockFileStorageService.upload.mockResolvedValue({
      key: 'insurance-member-3-1700000000000.pdf',
      url: 'https://cdn.example.com/evidence/member-3.pdf',
    });

    const resultPromise = service.createInsurance(
      'member-3',
      {
        insurance_type: 'CAMPOREE',
        start_date: '2025-02-01',
        end_date: '2025-12-31',
        policy_number: 'POL-123',
        provider: 'Seguros SACDIA',
        coverage_amount: '700',
      },
      {
        originalname: 'evidence.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('pdf'),
      } as Express.Multer.File,
      'admin-1',
    );

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        user_id: 'member-3',
        user: expect.objectContaining({
          user_id: 'member-3',
          name: 'Luis',
        }),
        insurance: expect.objectContaining({
          insurance_id: 12,
          evidence_file_name: 'evidence.pdf',
        }),
      }),
    );

    expect(mockFileStorageService.upload).toHaveBeenCalledWith(
      'INSURANCE_EVIDENCE',
      'insurance-member-3-1700000000000.pdf',
      expect.any(Buffer),
      { contentType: 'application/pdf' },
    );
    expect(mockPrismaService.member_insurances.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'member-3',
          created_by_id: 'admin-1',
          evidence_file_url: 'https://cdn.example.com/evidence/member-3.pdf',
          evidence_file_name: 'evidence.pdf',
        }),
      }),
    );
  });

  it('updates insurance with evidence upload and stores modified_by_id', async () => {
    mockPrismaService.member_insurances.findUnique.mockResolvedValue({
      insurance_id: 44,
      user_id: 'member-4',
      active: true,
    });
    mockPrismaService.member_insurances.update.mockResolvedValue({
      insurance_id: 44,
      user_id: 'member-4',
    });
    mockPrismaService.users.findUnique.mockResolvedValue({
      user_id: 'member-4',
      name: 'Sara',
      paternal_last_name: 'Mora',
      maternal_last_name: 'Vega',
      user_image: null,
      users_classes: [],
    });
    mockPrismaService.member_insurances.findFirst.mockResolvedValue({
      insurance_id: 44,
      user_id: 'member-4',
      insurance_type: 'HIGH_RISK',
      policy_number: 'POL-999',
      provider: 'Seguros SACDIA',
      start_date: new Date('2025-03-01'),
      end_date: new Date('2025-12-31'),
      coverage_amount: 900,
      active: true,
      evidence_file_url: 'https://cdn.example.com/evidence/member-4.pdf',
      evidence_file_name: 'updated.pdf',
      created_at: new Date('2025-03-01T12:00:00.000Z'),
      modified_at: new Date('2025-03-02T12:00:00.000Z'),
      created_by: { name: 'Admin User' },
      modified_by: { name: 'Editor User' },
    });
    mockFileStorageService.upload.mockResolvedValue({
      key: 'insurance-member-4-1700000000000.pdf',
      url: 'https://cdn.example.com/evidence/member-4.pdf',
    });

    const resultPromise = service.updateInsurance(
      44,
      {
        provider: 'Seguros SACDIA Plus',
        coverage_amount: '900',
      },
      {
        originalname: 'updated.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('pdf'),
      } as Express.Multer.File,
      'editor-1',
    );

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        user_id: 'member-4',
        user: expect.objectContaining({
          user_id: 'member-4',
          name: 'Sara',
        }),
        insurance: expect.objectContaining({
          insurance_id: 44,
          created_by_name: 'Admin User',
          modified_by_name: 'Editor User',
        }),
      }),
    );

    expect(mockFileStorageService.upload).toHaveBeenCalledWith(
      'INSURANCE_EVIDENCE',
      'insurance-member-4-1700000000000.pdf',
      expect.any(Buffer),
      { contentType: 'application/pdf' },
    );
    expect(mockPrismaService.member_insurances.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { insurance_id: 44 },
        data: expect.objectContaining({
          modified_by_id: 'editor-1',
          evidence_file_url: 'https://cdn.example.com/evidence/member-4.pdf',
          evidence_file_name: 'updated.pdf',
        }),
      }),
    );
  });

  it('throws when member does not exist', async () => {
    mockPrismaService.users.findUnique.mockResolvedValue(null);

    await expect(service.getMemberInsurance('missing-member')).rejects.toThrow(
      NotFoundException,
    );
  });
});
