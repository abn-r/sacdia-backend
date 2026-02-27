import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../common/supabase.service';
import { NotFoundException } from '@nestjs/common';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    users_allergies: {
      updateMany: jest.fn(),
    },
    users_diseases: {
      updateMany: jest.fn(),
    },
  };

  const mockSupabaseService = {
    admin: {
      storage: {
        from: jest.fn().mockReturnThis(),
        upload: jest.fn().mockResolvedValue({ error: null }),
        getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: 'url' } }),
        remove: jest.fn().mockResolvedValue({ error: null }),
      },
      auth: {
        admin: {
          createUser: jest.fn(),
          deleteUser: jest.fn(),
        },
      },
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('removeAllergy', () => {
    it('should soft-delete user allergy', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_allergies.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.removeAllergy('u1', 7);

      expect(mockPrismaService.users_allergies.updateMany).toHaveBeenCalledWith({
        where: {
          user_id: 'u1',
          allergy_id: 7,
          active: true,
        },
        data: {
          active: false,
          modified_at: expect.any(Date),
        },
      });
      expect(result).toEqual({
        status: 'success',
        data: {
          allergy_id: 7,
          active: false,
        },
        message: 'Alergia eliminada exitosamente',
      });
    });

    it('should throw when user allergy is not active/not found', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_allergies.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(service.removeAllergy('u1', 7)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeDisease', () => {
    it('should soft-delete user disease', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_diseases.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.removeDisease('u1', 5);

      expect(mockPrismaService.users_diseases.updateMany).toHaveBeenCalledWith({
        where: {
          user_id: 'u1',
          disease_id: 5,
          active: true,
        },
        data: {
          active: false,
          modified_at: expect.any(Date),
        },
      });
      expect(result).toEqual({
        status: 'success',
        data: {
          disease_id: 5,
          active: false,
        },
        message: 'Enfermedad eliminada exitosamente',
      });
    });
  });
});
