import { Test, TestingModule } from '@nestjs/testing';
import { LegalRepresentativesService } from './legal-representatives.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

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
    relationship_types: {
      findUnique: jest.fn(),
    },
  };

  const mockUsersService = {
    requiresLegalRepresentative: jest.fn(),
    findOne: jest.fn(),
  };

  const userId = '20a9a762-a4fa-49dd-93a6-3851e27f8b69';
  const repUserId = 'aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee';
  const relTypeId = 'ffff2222-aaaa-bbbb-cccc-111111111111';

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

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------
  describe('findOne', () => {
    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.findOne(userId)).rejects.toThrow(
        new NotFoundException('Usuario no encontrado'),
      );
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
      const rep = { user_id: userId, name: 'María', relationship_types: { name: 'Madre' } };
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

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    const baseDto = {
      relationship_type_id: relTypeId,
    };

    it('should throw BadRequestException when user does not require a legal representative', async () => {
      mockUsersService.requiresLegalRepresentative.mockResolvedValue(false);

      await expect(
        service.create(userId, { ...baseDto, name: 'Ana', paternal_last_name: 'López', phone: '1234567890' }),
      ).rejects.toThrow(
        new BadRequestException(
          'Usuario mayor de 18 años no requiere representante legal',
        ),
      );
    });

    it('should throw ConflictException when user already has a representative', async () => {
      mockUsersService.requiresLegalRepresentative.mockResolvedValue(true);
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue({
        user_id: userId,
      });

      await expect(
        service.create(userId, { ...baseDto, name: 'Ana', paternal_last_name: 'López', phone: '1234567890' }),
      ).rejects.toThrow(
        new ConflictException('El usuario ya tiene un representante legal'),
      );
    });

    it('should throw BadRequestException when neither representative_user_id nor manual data is provided', async () => {
      mockUsersService.requiresLegalRepresentative.mockResolvedValue(true);
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue(null);

      // No representative_user_id, no name, no paternal_last_name, no phone
      await expect(
        service.create(userId, { relationship_type_id: relTypeId }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when manual data is incomplete (missing phone)', async () => {
      mockUsersService.requiresLegalRepresentative.mockResolvedValue(true);
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue(null);

      await expect(
        service.create(userId, {
          relationship_type_id: relTypeId,
          name: 'Ana',
          paternal_last_name: 'López',
          // phone intentionally omitted
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when representative_user_id does not exist', async () => {
      mockUsersService.requiresLegalRepresentative.mockResolvedValue(true);
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue(null);
      mockPrismaService.users.findUnique.mockResolvedValue(null); // rep user not found

      await expect(
        service.create(userId, {
          relationship_type_id: relTypeId,
          representative_user_id: repUserId,
        }),
      ).rejects.toThrow(
        new NotFoundException('Usuario representante no encontrado'),
      );
    });

    it('should throw NotFoundException when relationship_type_id does not exist', async () => {
      mockUsersService.requiresLegalRepresentative.mockResolvedValue(true);
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue(null);
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: repUserId });
      mockPrismaService.relationship_types.findUnique.mockResolvedValue(null);

      await expect(
        service.create(userId, {
          relationship_type_id: relTypeId,
          representative_user_id: repUserId,
        }),
      ).rejects.toThrow(new NotFoundException('Tipo de relación no encontrado'));
    });

    it('should create representative with a registered user (representative_user_id path)', async () => {
      const created = {
        user_id: userId,
        representative_user_id: repUserId,
        relationship_type_id: relTypeId,
        relationship_types: { name: 'Padre' },
      };

      mockUsersService.requiresLegalRepresentative.mockResolvedValue(true);
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue(null);
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: repUserId });
      mockPrismaService.relationship_types.findUnique.mockResolvedValue({
        relationship_type_id: relTypeId,
        name: 'Padre',
      });
      mockPrismaService.legal_representatives.create.mockResolvedValue(created);

      const result = await service.create(userId, {
        relationship_type_id: relTypeId,
        representative_user_id: repUserId,
      });

      expect(result).toEqual({
        status: 'success',
        data: created,
        message: 'Representante legal registrado exitosamente',
      });
      expect(mockPrismaService.legal_representatives.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: userId,
            representative_user_id: repUserId,
          }),
        }),
      );
    });

    it('should create representative with manual data (name + paternal_last_name + phone)', async () => {
      const dto = {
        relationship_type_id: relTypeId,
        name: 'Ana',
        paternal_last_name: 'López',
        maternal_last_name: 'García',
        phone: '5551234567',
      };
      const created = {
        user_id: userId,
        ...dto,
        relationship_types: { name: 'Madre' },
      };

      mockUsersService.requiresLegalRepresentative.mockResolvedValue(true);
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue(null);
      // No representative_user_id check needed for this path
      mockPrismaService.relationship_types.findUnique.mockResolvedValue({
        relationship_type_id: relTypeId,
        name: 'Madre',
      });
      mockPrismaService.legal_representatives.create.mockResolvedValue(created);

      const result = await service.create(userId, dto);

      expect(result.status).toBe('success');
      expect(result.message).toBe('Representante legal registrado exitosamente');
      expect(mockPrismaService.legal_representatives.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: userId,
            name: 'Ana',
            paternal_last_name: 'López',
            phone: '5551234567',
          }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('should throw NotFoundException when representative does not exist', async () => {
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue(null);

      await expect(
        service.update(userId, { name: 'Nuevo nombre' }),
      ).rejects.toThrow(
        new NotFoundException('Representante legal no encontrado'),
      );
    });

    it('should throw NotFoundException when representative_user_id is provided but does not exist', async () => {
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue({
        user_id: userId,
      });
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(
        service.update(userId, { representative_user_id: repUserId }),
      ).rejects.toThrow(
        new NotFoundException('Usuario representante no encontrado'),
      );
    });

    it('should throw NotFoundException when relationship_type_id is provided but does not exist', async () => {
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue({
        user_id: userId,
      });
      mockPrismaService.relationship_types.findUnique.mockResolvedValue(null);

      await expect(
        service.update(userId, { relationship_type_id: relTypeId }),
      ).rejects.toThrow(
        new NotFoundException('Tipo de relación no encontrado'),
      );
    });

    it('should update representative successfully (name-only update)', async () => {
      const updated = {
        user_id: userId,
        name: 'Nuevo Nombre',
        relationship_types: { name: 'Madre' },
      };

      mockPrismaService.legal_representatives.findUnique.mockResolvedValue({
        user_id: userId,
      });
      mockPrismaService.legal_representatives.update.mockResolvedValue(updated);

      const result = await service.update(userId, { name: 'Nuevo Nombre' });

      expect(result).toEqual({
        status: 'success',
        data: updated,
        message: 'Representante legal actualizado exitosamente',
      });
      expect(mockPrismaService.legal_representatives.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: userId },
          data: { name: 'Nuevo Nombre' },
        }),
      );
    });

    it('should verify representative_user_id and relationship_type_id when both are provided', async () => {
      const updated = {
        user_id: userId,
        representative_user_id: repUserId,
        relationship_type_id: relTypeId,
        relationship_types: { name: 'Padre' },
      };

      mockPrismaService.legal_representatives.findUnique.mockResolvedValue({
        user_id: userId,
      });
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: repUserId });
      mockPrismaService.relationship_types.findUnique.mockResolvedValue({
        relationship_type_id: relTypeId,
      });
      mockPrismaService.legal_representatives.update.mockResolvedValue(updated);

      const result = await service.update(userId, {
        representative_user_id: repUserId,
        relationship_type_id: relTypeId,
      });

      expect(result.status).toBe('success');
      expect(mockPrismaService.users.findUnique).toHaveBeenCalledWith({
        where: { user_id: repUserId },
      });
      expect(mockPrismaService.relationship_types.findUnique).toHaveBeenCalledWith({
        where: { relationship_type_id: relTypeId },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------
  describe('remove', () => {
    it('should throw NotFoundException when representative does not exist', async () => {
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue(null);

      await expect(service.remove(userId)).rejects.toThrow(
        new NotFoundException('Representante legal no encontrado'),
      );
    });

    it('should delete representative and return success message', async () => {
      mockPrismaService.legal_representatives.findUnique.mockResolvedValue({
        user_id: userId,
      });
      mockPrismaService.legal_representatives.delete.mockResolvedValue({
        user_id: userId,
      });

      const result = await service.remove(userId);

      expect(result).toEqual({
        status: 'success',
        message: 'Representante legal eliminado exitosamente',
      });
      expect(mockPrismaService.legal_representatives.delete).toHaveBeenCalledWith({
        where: { user_id: userId },
      });
    });
  });
});
