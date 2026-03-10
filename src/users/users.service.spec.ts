import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';

describe('UsersService', () => {
  let service: UsersService;

  const createTransactionMock = () => ({
    users_medicines: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  });

  let transactionMock: ReturnType<typeof createTransactionMock>;

  const mockPrismaService = {
    $transaction: jest.fn(),
    users: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    users_allergies: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    users_diseases: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    medicines: {
      findMany: jest.fn(),
    },
    users_medicines: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockFileStorageService = {
    upload: jest.fn().mockResolvedValue({
      key: 'photo-u1-123.jpeg',
      url: 'https://cdn.r2.example/user-profiles/photo-u1-123.jpeg',
    }),
    deleteMany: jest.fn().mockResolvedValue(undefined),
    extractKeyFromPublicUrl: jest.fn().mockReturnValue('photo-u1-122.jpeg'),
    getSignedDownloadUrl: jest.fn(
      (_bucket: StorageBucketAlias, value: string) => Promise.resolve(value),
    ),
  };

  beforeEach(async () => {
    transactionMock = createTransactionMock();
    mockPrismaService.$transaction.mockImplementation(
      (
        callback: (
          tx: ReturnType<typeof createTransactionMock>,
        ) => Promise<unknown>,
      ) => callback(transactionMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
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

  describe('getAllergies', () => {
    it('should return active allergies as a flat list', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_allergies.findMany.mockResolvedValue([
        {
          allergy_id: 2,
          allergies: {
            name: 'Polen',
          },
        },
        {
          allergy_id: 9,
          allergies: {
            name: 'Lactosa',
          },
        },
      ]);

      const result = await service.getAllergies('u1');

      expect(mockPrismaService.users_allergies.findMany).toHaveBeenCalledWith({
        where: {
          user_id: 'u1',
          active: true,
        },
        select: {
          allergy_id: true,
          allergies: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { allergy_id: 'asc' },
      });
      expect(result).toEqual({
        status: 'success',
        data: [
          { allergy_id: 2, name: 'Polen' },
          { allergy_id: 9, name: 'Lactosa' },
        ],
      });
    });

    it('should return an empty list for an existing user without active allergies', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_allergies.findMany.mockResolvedValue([]);

      await expect(service.getAllergies('u1')).resolves.toEqual({
        status: 'success',
        data: [],
      });
    });

    it('should throw when the user does not exist', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.getAllergies('missing-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getDiseases', () => {
    it('should return active diseases as a flat list', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_diseases.findMany.mockResolvedValue([
        {
          disease_id: 4,
          diseases: {
            name: 'Asma',
          },
        },
        {
          disease_id: 8,
          diseases: {
            name: 'Diabetes',
          },
        },
      ]);

      const result = await service.getDiseases('u1');

      expect(mockPrismaService.users_diseases.findMany).toHaveBeenCalledWith({
        where: {
          user_id: 'u1',
          active: true,
        },
        select: {
          disease_id: true,
          diseases: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { disease_id: 'asc' },
      });
      expect(result).toEqual({
        status: 'success',
        data: [
          { disease_id: 4, name: 'Asma' },
          { disease_id: 8, name: 'Diabetes' },
        ],
      });
    });

    it('should return an empty list for an existing user without active diseases', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_diseases.findMany.mockResolvedValue([]);

      await expect(service.getDiseases('u1')).resolves.toEqual({
        status: 'success',
        data: [],
      });
    });

    it('should throw when the user does not exist', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.getDiseases('missing-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMedicines', () => {
    it('should return active medicines as a flat list', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_medicines.findMany.mockResolvedValue([
        {
          medicine_id: 3,
          medicines: {
            name: 'Ibuprofeno',
          },
        },
        {
          medicine_id: 9,
          medicines: {
            name: 'Paracetamol',
          },
        },
      ]);

      const result = await service.getMedicines('u1');

      expect(result).toEqual({
        status: 'success',
        data: [
          { medicine_id: 3, name: 'Ibuprofeno' },
          { medicine_id: 9, name: 'Paracetamol' },
        ],
      });
    });

    it('should return an empty list for an existing user without active medicines', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_medicines.findMany.mockResolvedValue([]);

      await expect(service.getMedicines('u1')).resolves.toEqual({
        status: 'success',
        data: [],
      });
    });
  });

  describe('updateMedicines', () => {
    it('should replace the active medicines set for a user', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.medicines.findMany.mockResolvedValue([
        { medicine_id: 3 },
        { medicine_id: 7 },
      ]);
      transactionMock.users_medicines.findMany.mockResolvedValue([
        {
          medicine_id: 3,
          medicines: {
            name: 'Ibuprofeno',
            description: 'Analgésico',
          },
        },
        {
          medicine_id: 7,
          medicines: {
            name: 'Paracetamol',
            description: 'Antipirético',
          },
        },
      ]);

      const result = await service.updateMedicines('u1', {
        medicine_ids: [3, 7],
      });

      expect(result).toEqual({
        status: 'success',
        data: [
          {
            medicine_id: 3,
            medicines: {
              name: 'Ibuprofeno',
              description: 'Analgésico',
            },
          },
          {
            medicine_id: 7,
            medicines: {
              name: 'Paracetamol',
              description: 'Antipirético',
            },
          },
        ],
        message: 'Medicamentos actualizados exitosamente',
      });
    });

    it('should reject invalid or inactive medicines', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.medicines.findMany.mockResolvedValue([
        { medicine_id: 3 },
      ]);

      await expect(
        service.updateMedicines('u1', { medicine_ids: [3, 99] }),
      ).rejects.toThrow(
        new BadRequestException('Medicamentos inválidos o inactivos: 99'),
      );
    });
  });

  describe('removeMedicine', () => {
    it('should soft-delete user medicine', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_medicines.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.removeMedicine('u1', 5);

      expect(result).toEqual({
        status: 'success',
        data: {
          medicine_id: 5,
          active: false,
        },
        message: 'Medicamento eliminado exitosamente',
      });
    });
  });

  describe('removeAllergy', () => {
    it('should soft-delete user allergy', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_allergies.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.removeAllergy('u1', 7);

      const removeAllergyCalls = mockPrismaService.users_allergies.updateMany
        .mock.calls as Array<
        [
          {
            where: { user_id: string; allergy_id: number; active: boolean };
            data: { active: boolean; modified_at: Date };
          },
        ]
      >;
      const removeAllergyCall = removeAllergyCalls[0]?.[0] as {
        where: { user_id: string; allergy_id: number; active: boolean };
        data: { active: boolean; modified_at: Date };
      };

      expect(removeAllergyCall.where).toEqual({
        user_id: 'u1',
        allergy_id: 7,
        active: true,
      });
      expect(removeAllergyCall.data.active).toBe(false);
      expect(removeAllergyCall.data.modified_at).toBeInstanceOf(Date);
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

      const removeDiseaseCalls = mockPrismaService.users_diseases.updateMany
        .mock.calls as Array<
        [
          {
            where: { user_id: string; disease_id: number; active: boolean };
            data: { active: boolean; modified_at: Date };
          },
        ]
      >;
      const removeDiseaseCall = removeDiseaseCalls[0]?.[0] as {
        where: { user_id: string; disease_id: number; active: boolean };
        data: { active: boolean; modified_at: Date };
      };

      expect(removeDiseaseCall.where).toEqual({
        user_id: 'u1',
        disease_id: 5,
        active: true,
      });
      expect(removeDiseaseCall.data.active).toBe(false);
      expect(removeDiseaseCall.data.modified_at).toBeInstanceOf(Date);
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

  describe('uploadProfilePicture', () => {
    const file = {
      originalname: 'profile.jpeg',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('image'),
    } as Express.Multer.File;

    it('should upload to R2, persist URL in DB, and cleanup previous R2 image', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'u1',
        user_image: 'https://cdn.r2.example/user-profiles/photo-u1-122.jpeg',
      });
      mockPrismaService.users.update.mockResolvedValue({ user_id: 'u1' });

      const result = await service.uploadProfilePicture('u1', file);

      const updateCalls = mockPrismaService.users.update.mock.calls as Array<
        [
          {
            where: { user_id: string };
            data: { user_image: string };
          },
        ]
      >;
      const updateCall = updateCalls[0]?.[0] as {
        where: { user_id: string };
        data: { user_image: string };
      };

      expect(mockFileStorageService.upload).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        expect.stringMatching(/^photo-u1-\d+\.jpeg$/),
        file.buffer,
        expect.objectContaining({ contentType: 'image/jpeg' }),
      );
      expect(updateCall.where).toEqual({ user_id: 'u1' });
      expect(updateCall.data.user_image).toContain('https://cdn.r2.example/');
      expect(mockFileStorageService.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        ['photo-u1-122.jpeg'],
      );
      expect(result.status).toBe('success');
      expect(result.data.url).toContain('https://cdn.r2.example/');
    });

    it('should abort DB update when R2 upload fails', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'u1',
        user_image: null,
      });
      mockFileStorageService.upload.mockRejectedValueOnce(
        new Error('upload failed'),
      );

      await expect(service.uploadProfilePicture('u1', file)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(mockPrismaService.users.update).not.toHaveBeenCalled();
    });

    it('should rollback uploaded object when DB update fails', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'u1',
        user_image: null,
      });
      mockFileStorageService.upload.mockResolvedValueOnce({
        key: 'photo-u1-999.jpeg',
        url: 'https://cdn.r2.example/user-profiles/photo-u1-999.jpeg',
      });
      mockPrismaService.users.update.mockRejectedValueOnce(
        new Error('db fail'),
      );

      await expect(service.uploadProfilePicture('u1', file)).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(mockFileStorageService.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        ['photo-u1-999.jpeg'],
      );
    });
  });

  describe('deleteProfilePicture', () => {
    it('should clear DB image and delete from R2 when url is from R2', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_image: 'https://cdn.r2.example/user-profiles/photo-u1-122.jpeg',
      });
      mockPrismaService.users.update
        .mockResolvedValueOnce({ user_id: 'u1' })
        .mockResolvedValueOnce({ user_id: 'u1' });

      const result = await service.deleteProfilePicture('u1');

      expect(mockPrismaService.users.update).toHaveBeenNthCalledWith(1, {
        where: { user_id: 'u1' },
        data: { user_image: null },
      });
      expect(mockFileStorageService.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        ['photo-u1-122.jpeg'],
      );
      expect(result).toEqual({
        status: 'success',
        message: 'Foto de perfil eliminada exitosamente',
      });
    });

    it('should restore DB value when R2 deletion fails', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_image: 'https://cdn.r2.example/user-profiles/photo-u1-122.jpeg',
      });
      mockPrismaService.users.update
        .mockResolvedValueOnce({ user_id: 'u1' })
        .mockResolvedValueOnce({ user_id: 'u1' });
      mockFileStorageService.deleteMany.mockRejectedValueOnce(
        new Error('r2 delete failed'),
      );

      await expect(service.deleteProfilePicture('u1')).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(mockPrismaService.users.update).toHaveBeenNthCalledWith(1, {
        where: { user_id: 'u1' },
        data: { user_image: null },
      });
      expect(mockPrismaService.users.update).toHaveBeenNthCalledWith(2, {
        where: { user_id: 'u1' },
        data: {
          user_image: 'https://cdn.r2.example/user-profiles/photo-u1-122.jpeg',
        },
      });
    });
  });
});
