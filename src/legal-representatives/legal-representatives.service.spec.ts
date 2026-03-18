import { Test, TestingModule } from '@nestjs/testing';
import { LegalRepresentativesService } from './legal-representatives.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { NotFoundException } from '@nestjs/common';

describe('LegalRepresentativesService', () => {
  let service: LegalRepresentativesService;

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
    },
    legal_representatives: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockUsersService = {
    requiresLegalRepresentative: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegalRepresentativesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    service = module.get<LegalRepresentativesService>(
      LegalRepresentativesService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne', () => {
    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne('20a9a762-a4fa-49dd-93a6-3851e27f8b69'),
      ).rejects.toThrow(new NotFoundException('Usuario no encontrado'));
    });

    it('should return success with null data when user exists without legal representative', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: '20a9a762-a4fa-49dd-93a6-3851e27f8b69',
      });
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue(
        null,
      );

      const result = await service.findOne(
        '20a9a762-a4fa-49dd-93a6-3851e27f8b69',
      );

      expect(result).toEqual({
        status: 'success',
        data: null,
        hasLegalRepresentative: false,
        message: 'Usuario sin representante legal registrado',
      });
    });
  });
});
