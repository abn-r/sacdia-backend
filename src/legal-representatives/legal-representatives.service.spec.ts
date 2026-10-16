import { Test, TestingModule } from '@nestjs/testing';
import { LegalRepresentativesService } from './legal-representatives.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('LegalRepresentativesService', () => {
  let service: LegalRepresentativesService;

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
    },
    legal_representatives: {
      findUnique: jest.fn(),
    },
  };

  const userId = '20a9a762-a4fa-49dd-93a6-3851e27f8b69';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegalRepresentativesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<LegalRepresentativesService>(
      LegalRepresentativesService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('is read-only: exposes no write methods (family-profiles Phase 2, FP-26)', () => {
    const proto = Object.getOwnPropertyNames(
      LegalRepresentativesService.prototype,
    ).filter((name) => name !== 'constructor');
    expect(proto).toEqual(['findOne']);
  });

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------
  describe('findOne', () => {
    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.findOne(userId)).rejects.toMatchObject({
        code: ErrorCode.LEGAL_REP_OWNER_NOT_FOUND,
      });
    });

    it('should return success with null data when user exists without legal representative', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: userId });
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue(
        null,
      );

      const result = await service.findOne(userId);

      expect(result).toEqual({
        status: 'success',
        data: null,
        hasLegalRepresentative: false,
        message: 'Usuario sin representante legal registrado',
      });
    });

    it('should return representative data when it exists', async () => {
      const rep = {
        user_id: userId,
        name: 'María',
        relationship_types: { name: 'Madre' },
      };
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: userId });
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue(rep);

      const result = await service.findOne(userId);

      expect(result).toEqual({
        status: 'success',
        data: rep,
        hasLegalRepresentative: true,
      });
    });
  });
});
