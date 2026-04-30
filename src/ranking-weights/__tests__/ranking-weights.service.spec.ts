import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RankingWeightsService } from '../ranking-weights.service';
import { PrismaService } from '../../prisma/prisma.service';

// ── helpers ────────────────────────────────────────────────────────────────────

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  ranking_weight_config_id: 'uuid-1',
  club_type_id: null,
  folder_weight: 25,
  finance_weight: 25,
  camporee_weight: 25,
  evidence_weight: 25,
  created_at: new Date(),
  updated_at: new Date(),
  updated_by: null,
  ...overrides,
});

const overrideRow = makeRow({ ranking_weight_config_id: 'uuid-2', club_type_id: 1 });

// ── mock ───────────────────────────────────────────────────────────────────────

const prismaMock = {
  ranking_weight_configs: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

// ── suite ──────────────────────────────────────────────────────────────────────

describe('RankingWeightsService', () => {
  let service: RankingWeightsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingWeightsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<RankingWeightsService>(RankingWeightsService);
    jest.clearAllMocks();
  });

  // ── list ────────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns prisma findMany result', async () => {
      const rows = [makeRow(), overrideRow];
      prismaMock.ranking_weight_configs.findMany.mockResolvedValue(rows);

      const result = await service.list();

      expect(result).toBe(rows);
      expect(prismaMock.ranking_weight_configs.findMany).toHaveBeenCalledWith({
        orderBy: [{ club_type_id: 'asc' }],
      });
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────────

  describe('getById()', () => {
    it('returns row when found', async () => {
      prismaMock.ranking_weight_configs.findUnique.mockResolvedValue(overrideRow);
      await expect(service.getById('uuid-2')).resolves.toBe(overrideRow);
    });

    it('throws NotFoundException when row is missing', async () => {
      prismaMock.ranking_weight_configs.findUnique.mockResolvedValue(null);
      await expect(service.getById('missing-uuid')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create()', () => {
    const validDto = {
      club_type_id: 2,
      folder_weight: 30,
      finance_weight: 25,
      camporee_weight: 25,
      evidence_weight: 20,
    };

    it('rejects when club_type_id is null (default global reserved)', async () => {
      await expect(
        service.create({ ...validDto, club_type_id: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.ranking_weight_configs.create).not.toHaveBeenCalled();
    });

    it('rejects when weights do not sum to 100', async () => {
      await expect(
        service.create({ ...validDto, folder_weight: 10 }), // sum = 80
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.ranking_weight_configs.create).not.toHaveBeenCalled();
    });

    it('rejects with ConflictException when override already exists', async () => {
      prismaMock.ranking_weight_configs.findUnique.mockResolvedValue(overrideRow);

      await expect(service.create(validDto)).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.ranking_weight_configs.create).not.toHaveBeenCalled();
    });

    it('creates row when all validations pass', async () => {
      prismaMock.ranking_weight_configs.findUnique.mockResolvedValue(null);
      const created = makeRow({ ...validDto });
      prismaMock.ranking_weight_configs.create.mockResolvedValue(created);

      const result = await service.create(validDto, 'user-uuid');

      expect(result).toBe(created);
      expect(prismaMock.ranking_weight_configs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            club_type_id: 2,
            folder_weight: 30,
            updated_by: 'user-uuid',
          }),
        }),
      );
    });
  });

  // ── update ──────────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('rejects when merged weights do not sum to 100', async () => {
      prismaMock.ranking_weight_configs.findUnique.mockResolvedValue(overrideRow);
      // overrideRow has 25/25/25/25; patching folder_weight=10 => sum=85
      await expect(
        service.update('uuid-2', { folder_weight: 10 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.ranking_weight_configs.update).not.toHaveBeenCalled();
    });

    it('succeeds when merged weights sum to 100', async () => {
      prismaMock.ranking_weight_configs.findUnique.mockResolvedValue(overrideRow);
      // overrideRow 25/25/25/25; patch folder=40 => need to also patch one other to keep sum=100
      // folder:40, finance:25, camporee:25, evidence:10 = 100
      const updated = { ...overrideRow, folder_weight: 40, evidence_weight: 10 };
      prismaMock.ranking_weight_configs.update.mockResolvedValue(updated);

      const result = await service.update(
        'uuid-2',
        { folder_weight: 40, evidence_weight: 10 },
        'user-uuid',
      );

      expect(result).toBe(updated);
      expect(prismaMock.ranking_weight_configs.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ranking_weight_config_id: 'uuid-2' },
          data: expect.objectContaining({
            folder_weight: 40,
            evidence_weight: 10,
            updated_by: 'user-uuid',
          }),
        }),
      );
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('rejects when row is the default global (club_type_id = null)', async () => {
      prismaMock.ranking_weight_configs.findUnique.mockResolvedValue(makeRow()); // club_type_id: null
      await expect(service.delete('uuid-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.ranking_weight_configs.delete).not.toHaveBeenCalled();
    });

    it('deletes when row is an override (club_type_id != null)', async () => {
      prismaMock.ranking_weight_configs.findUnique.mockResolvedValue(overrideRow);
      prismaMock.ranking_weight_configs.delete.mockResolvedValue(overrideRow);

      const result = await service.delete('uuid-2');

      expect(result).toBe(overrideRow);
      expect(prismaMock.ranking_weight_configs.delete).toHaveBeenCalledWith({
        where: { ranking_weight_config_id: 'uuid-2' },
      });
    });
  });
});
