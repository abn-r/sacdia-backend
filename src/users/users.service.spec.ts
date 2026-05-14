import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { SeverityLevel } from './dto/update-user-medical.dto';

describe('UsersService', () => {
  let service: UsersService;

  // ---- transaction mock helpers ----

  const createTransactionMock = () => ({
    users_medicines: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    users_allergies: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    users_diseases: {
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
    allergies: {
      findMany: jest.fn(),
    },
    diseases: {
      findMany: jest.fn(),
    },
    medicines: {
      findMany: jest.fn(),
    },
    users_medicines: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    countries: {
      findFirst: jest.fn(),
    },
    unions: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    local_fields: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
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
    it('should return active allergies with severity as a flat list', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_allergies.findMany.mockResolvedValue([
        {
          allergy_id: 2,
          severity: SeverityLevel.leve,
          allergies: { name: 'Polen' },
        },
        {
          allergy_id: 9,
          severity: SeverityLevel.alta,
          allergies: { name: 'Lactosa' },
        },
      ]);

      const result = await service.getAllergies('u1');

      expect(mockPrismaService.users_allergies.findMany).toHaveBeenCalledWith({
        where: { user_id: 'u1', active: true },
        select: {
          allergy_id: true,
          severity: true,
          allergies: { select: { name: true } },
        },
        orderBy: { allergy_id: 'asc' },
      });
      expect(result).toEqual({
        status: 'success',
        data: [
          { allergy_id: 2, name: 'Polen', severity: SeverityLevel.leve },
          { allergy_id: 9, name: 'Lactosa', severity: SeverityLevel.alta },
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

      await expect(service.getAllergies('missing-user')).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_FOUND,
      });
    });
  });

  describe('getDiseases', () => {
    it('should return active diseases with since_year as a flat list', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_diseases.findMany.mockResolvedValue([
        { disease_id: 4, since_year: 2015, diseases: { name: 'Asma' } },
        { disease_id: 8, since_year: null, diseases: { name: 'Diabetes' } },
      ]);

      const result = await service.getDiseases('u1');

      expect(mockPrismaService.users_diseases.findMany).toHaveBeenCalledWith({
        where: { user_id: 'u1', active: true },
        select: {
          disease_id: true,
          since_year: true,
          diseases: { select: { name: true } },
        },
        orderBy: { disease_id: 'asc' },
      });
      expect(result).toEqual({
        status: 'success',
        data: [
          { disease_id: 4, name: 'Asma', since_year: 2015 },
          { disease_id: 8, name: 'Diabetes', since_year: null },
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

      await expect(service.getDiseases('missing-user')).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_FOUND,
      });
    });
  });

  describe('getMedicines', () => {
    it('should return active medicines with dose as a flat list', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_medicines.findMany.mockResolvedValue([
        { medicine_id: 3, dose: '5 mg cada 8 hs', medicines: { name: 'Ibuprofeno' } },
        { medicine_id: 9, dose: null, medicines: { name: 'Paracetamol' } },
      ]);

      const result = await service.getMedicines('u1');

      expect(mockPrismaService.users_medicines.findMany).toHaveBeenCalledWith({
        where: { user_id: 'u1', active: true },
        select: {
          medicine_id: true,
          dose: true,
          medicines: { select: { name: true } },
        },
        orderBy: { medicine_id: 'asc' },
      });
      expect(result).toEqual({
        status: 'success',
        data: [
          { medicine_id: 3, name: 'Ibuprofeno', dose: '5 mg cada 8 hs' },
          { medicine_id: 9, name: 'Paracetamol', dose: null },
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
    it('should replace the active medicines set for a user with dose', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.medicines.findMany.mockResolvedValue([
        { medicine_id: 3 },
        { medicine_id: 7 },
      ]);
      transactionMock.users_medicines.findMany.mockResolvedValue([
        { medicine_id: 3, dose: '5 mg cada 8 hs', medicines: { name: 'Ibuprofeno' } },
        { medicine_id: 7, dose: null, medicines: { name: 'Paracetamol' } },
      ]);

      const result = await service.updateMedicines('u1', {
        medicines: [
          { id: 3, dose: '5 mg cada 8 hs' },
          { id: 7 },
        ],
      });

      expect(result).toEqual({
        status: 'success',
        data: [
          { medicine_id: 3, name: 'Ibuprofeno', dose: '5 mg cada 8 hs' },
          { medicine_id: 7, name: 'Paracetamol', dose: null },
        ],
        message: 'Medicamentos actualizados exitosamente',
      });
    });

    it('should store NULL dose when dose is omitted', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.medicines.findMany.mockResolvedValue([{ medicine_id: 3 }]);
      transactionMock.users_medicines.findFirst.mockResolvedValue(null);
      transactionMock.users_medicines.findMany.mockResolvedValue([
        { medicine_id: 3, dose: null, medicines: { name: 'Ibuprofeno' } },
      ]);

      await service.updateMedicines('u1', { medicines: [{ id: 3 }] });

      expect(transactionMock.users_medicines.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dose: null }),
        }),
      );
    });

    it('should reject invalid or inactive medicines', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.medicines.findMany.mockResolvedValue([{ medicine_id: 3 }]);

      await expect(
        service.updateMedicines('u1', {
          medicines: [{ id: 3, dose: '5 mg' }, { id: 99 }],
        }),
      ).rejects.toMatchObject({ code: ErrorCode.USER_MEDICINE_INVALID });
    });
  });

  describe('updateAllergies', () => {
    it('should replace the active allergies set with severity per entry', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.allergies.findMany.mockResolvedValue([
        { allergy_id: 1 },
        { allergy_id: 3 },
      ]);
      transactionMock.users_allergies.findFirst.mockResolvedValue(null);
      transactionMock.users_allergies.findMany.mockResolvedValue([
        { allergy_id: 1, severity: SeverityLevel.alta, allergies: { name: 'Polen' } },
        { allergy_id: 3, severity: SeverityLevel.media, allergies: { name: 'Penicilina' } },
      ]);

      const result = await service.updateAllergies('u1', {
        allergies: [
          { id: 1, severity: SeverityLevel.alta },
          { id: 3, severity: SeverityLevel.media },
        ],
      });

      expect(result).toEqual({
        status: 'success',
        data: [
          { allergy_id: 1, name: 'Polen', severity: SeverityLevel.alta },
          { allergy_id: 3, name: 'Penicilina', severity: SeverityLevel.media },
        ],
        message: 'Alergias actualizadas exitosamente',
      });
    });

    it('should persist severity on newly created allergy row', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.allergies.findMany.mockResolvedValue([{ allergy_id: 5 }]);
      transactionMock.users_allergies.findFirst.mockResolvedValue(null);
      transactionMock.users_allergies.findMany.mockResolvedValue([
        { allergy_id: 5, severity: SeverityLevel.alta, allergies: { name: 'Latex' } },
      ]);

      await service.updateAllergies('u1', {
        allergies: [{ id: 5, severity: SeverityLevel.alta }],
      });

      expect(transactionMock.users_allergies.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ severity: SeverityLevel.alta }),
        }),
      );
    });
  });

  describe('updateDiseases', () => {
    it('should replace the active diseases set with since_year per entry', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.diseases.findMany.mockResolvedValue([{ disease_id: 4 }]);
      transactionMock.users_diseases.findFirst.mockResolvedValue(null);
      transactionMock.users_diseases.findMany.mockResolvedValue([
        { disease_id: 4, since_year: 2018, diseases: { name: 'Asma' } },
      ]);

      const result = await service.updateDiseases('u1', {
        diseases: [{ id: 4, since_year: 2018 }],
      });

      expect(result).toEqual({
        status: 'success',
        data: [{ disease_id: 4, name: 'Asma', since_year: 2018 }],
        message: 'Enfermedades actualizadas exitosamente',
      });
    });

    it('should store NULL since_year when since_year is omitted', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.diseases.findMany.mockResolvedValue([{ disease_id: 4 }]);
      transactionMock.users_diseases.findFirst.mockResolvedValue(null);
      transactionMock.users_diseases.findMany.mockResolvedValue([
        { disease_id: 4, since_year: null, diseases: { name: 'Asma' } },
      ]);

      await service.updateDiseases('u1', { diseases: [{ id: 4 }] });

      expect(transactionMock.users_diseases.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ since_year: null }),
        }),
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
      const removeAllergyCall = removeAllergyCalls[0]?.[0];

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

      await expect(service.removeAllergy('u1', 7)).rejects.toMatchObject({
        code: ErrorCode.USER_ALLERGY_NOT_IN_PROFILE,
      });
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
      const removeDiseaseCall = removeDiseaseCalls[0]?.[0];

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
      const updateCall = updateCalls[0]?.[0];

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

      await expect(
        service.uploadProfilePicture('u1', file),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_IMAGE_UPLOAD_FAILED,
      });
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

      await expect(
        service.uploadProfilePicture('u1', file),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_IMAGE_UPDATE_FAILED,
      });

      expect(mockFileStorageService.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        ['photo-u1-999.jpeg'],
      );
    });

    it('should succeed even when best-effort old-file cleanup fails (fire-and-forget)', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'u1',
        user_image: 'https://cdn.r2.example/user-profiles/photo-u1-old.jpeg',
      });
      mockPrismaService.users.update.mockResolvedValue({ user_id: 'u1' });
      // First deleteMany call (cleanup of old file) throws; should not surface
      mockFileStorageService.deleteMany.mockRejectedValueOnce(
        new Error('r2 cleanup failed'),
      );

      const result = await service.uploadProfilePicture('u1', file);

      // Response succeeds despite cleanup failure
      expect(result.status).toBe('success');
      // DB update was committed
      expect(mockPrismaService.users.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_image: expect.stringContaining('https://cdn.r2.example/'),
          }),
        }),
      );
      // deleteMany was attempted for the old key (fire-and-forget)
      expect(mockFileStorageService.deleteMany).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        expect.arrayContaining(['photo-u1-122.jpeg']),
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

      await expect(service.deleteProfilePicture('u1')).rejects.toMatchObject({
        code: ErrorCode.USER_IMAGE_DELETE_FAILED,
      });

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

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteProfilePicture('missing'),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_FOUND,
      });
    });

    it('should throw BadRequestException when user has no profile picture', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_image: null,
      });

      await expect(service.deleteProfilePicture('u1')).rejects.toMatchObject({
        code: ErrorCode.USER_NO_PROFILE_PICTURE,
      });
    });

    it('should skip R2 delete and log warning for non-R2 legacy urls', async () => {
      mockFileStorageService.extractKeyFromPublicUrl.mockReturnValueOnce(null);
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_image: 'https://legacy-cdn.example/photo-old.jpg',
      });
      mockPrismaService.users.update.mockResolvedValue({ user_id: 'u1' });

      const result = await service.deleteProfilePicture('u1');

      expect(mockFileStorageService.deleteMany).not.toHaveBeenCalled();
      expect(result.status).toBe('success');
    });
  });

  // ============================================================
  // findOne
  // ============================================================

  describe('findOne', () => {
    const baseUserRow = {
      user_id: 'u1',
      email: 'user@example.com',
      name: 'Juan',
      paternal_last_name: 'García',
      maternal_last_name: 'López',
      gender: 'M',
      birthday: new Date('2000-03-15'),
      baptism: true,
      baptism_date: new Date('2015-06-20'),
      blood: 'A_POSITIVE',
      user_image: null,
      country_id: 1,
      union_id: 2,
      local_field_id: 3,
      access_app: true,
      access_panel: false,
      created_at: new Date(),
      modified_at: new Date(),
    };

    it('TC-F01 - happy path: returns user without signed URL when no image', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        ...baseUserRow,
        user_image: null,
      });

      const result = await service.findOne('u1');

      expect(result.status).toBe('success');
      expect(result.data.user_id).toBe('u1');
      expect(
        mockFileStorageService.getSignedDownloadUrl,
      ).not.toHaveBeenCalled();
    });

    it('TC-F02 - happy path: generates signed URL when user has image', async () => {
      const storedUrl = 'https://cdn.r2.example/user-profiles/photo-u1.jpeg';
      mockPrismaService.users.findUnique.mockResolvedValue({
        ...baseUserRow,
        user_image: storedUrl,
      });
      mockFileStorageService.getSignedDownloadUrl.mockResolvedValueOnce(
        'https://signed.r2.example/photo-u1.jpeg?token=abc',
      );

      const result = await service.findOne('u1');

      expect(mockFileStorageService.getSignedDownloadUrl).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        storedUrl,
        expect.objectContaining({ expiresInSeconds: expect.any(Number) }),
      );
      expect(result.data.user_image).toBe(
        'https://signed.r2.example/photo-u1.jpeg?token=abc',
      );
    });

    it('TC-F03 - error: user not found → NotFoundException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_FOUND,
      });
    });

    it('TC-F04 - fallback: returns original URL when signed URL generation fails', async () => {
      const storedUrl = 'https://cdn.r2.example/user-profiles/photo-u1.jpeg';
      mockPrismaService.users.findUnique.mockResolvedValue({
        ...baseUserRow,
        user_image: storedUrl,
      });
      mockFileStorageService.getSignedDownloadUrl.mockRejectedValueOnce(
        new Error('R2 unavailable'),
      );

      const result = await service.findOne('u1');

      // The service catches the error and returns the original value
      expect(result.data.user_image).toBe(storedUrl);
    });
  });

  // ============================================================
  // update
  // ============================================================

  describe('update', () => {
    const existingUser = {
      user_id: 'u1',
      country_id: 1,
      union_id: 2,
      local_field_id: 3,
    };

    const updatedUserRow = {
      user_id: 'u1',
      email: 'user@example.com',
      name: 'Juan',
      paternal_last_name: 'García',
      maternal_last_name: 'López',
      gender: 'M',
      birthday: new Date('2000-03-15'),
      baptism: true,
      baptism_date: new Date('2015-06-20'),
      blood: 'A_POSITIVE',
      country_id: 1,
      union_id: 2,
      local_field_id: 3,
      modified_at: new Date(),
    };

    it('TC-U01 - happy path: updates user with valid data', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(existingUser);
      mockPrismaService.users.update.mockResolvedValue(updatedUserRow);
      // The service still cross-checks the existing union/country even when neither
      // field is being updated (targetCountryId=1, targetUnionId=2 from currentUser).
      // Supply a matching stub so validateGeographyReferences passes.
      mockPrismaService.unions.findUnique.mockResolvedValue({
        union_id: 2,
        country_id: 1,
      });
      // Also stub local_field cross-check (targetLocalFieldId=3, targetUnionId=2)
      mockPrismaService.local_fields.findUnique.mockResolvedValue({
        local_field_id: 3,
        union_id: 2,
      });

      const result = await service.update('u1', { gender: 'M' });

      expect(mockPrismaService.users.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 'u1' } }),
      );
      expect(result.status).toBe('success');
      expect(result.message).toBe('Usuario actualizado exitosamente');
    });

    it('TC-U02 - error: user not found → NotFoundException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing', { gender: 'F' }),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_FOUND,
      });
    });

    it('TC-U03 - error: baptism=false with baptism_date → BadRequestException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(existingUser);

      await expect(
        service.update('u1', {
          baptism: false,
          baptism_date: '2015-06-20',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.USER_BAPTISM_DATE_CONFLICT });
    });

    it('TC-U04 - geography: invalid country → BadRequestException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(existingUser);
      mockPrismaService.countries.findFirst.mockResolvedValue(null);

      await expect(
        service.update('u1', { country_id: 999 }),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_COUNTRY_INVALID,
      });
    });

    it('TC-U05 - geography: invalid union → BadRequestException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(existingUser);
      mockPrismaService.unions.findFirst.mockResolvedValue(null);

      await expect(
        service.update('u1', { union_id: 999 }),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_UNION_INVALID,
      });
    });

    it('TC-U06 - geography: invalid local_field → BadRequestException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(existingUser);
      mockPrismaService.local_fields.findFirst.mockResolvedValue(null);

      await expect(
        service.update('u1', { local_field_id: 999 }),
      ).rejects.toMatchObject({ code: ErrorCode.USER_LOCAL_FIELD_INVALID });
    });

    it('TC-U07 - geography: union does not belong to country → BadRequestException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(existingUser);
      // country valid
      mockPrismaService.countries.findFirst.mockResolvedValue({
        country_id: 5,
      });
      // union valid but belongs to a different country
      mockPrismaService.unions.findFirst.mockResolvedValue({
        union_id: 10,
        country_id: 99, // <-- mismatch
      });

      await expect(
        service.update('u1', { country_id: 5, union_id: 10 }),
      ).rejects.toMatchObject({ code: ErrorCode.USER_UNION_COUNTRY_MISMATCH });
    });

    it('TC-U08 - geography: local field does not belong to union → BadRequestException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        ...existingUser,
        country_id: null,
      });
      // No country update, so union cross-check is skipped.
      // local_field validation active
      mockPrismaService.local_fields.findFirst.mockResolvedValue({
        local_field_id: 50,
      });
      // the unique lookup returns a mismatched union
      mockPrismaService.local_fields.findUnique.mockResolvedValue({
        local_field_id: 50,
        union_id: 999, // <-- different from currentUser.union_id=2
      });

      await expect(
        service.update('u1', { local_field_id: 50 }),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_LOCAL_FIELD_UNION_MISMATCH,
      });
    });
  });

  // ============================================================
  // updateAllergies
  // ============================================================

  describe('updateAllergies', () => {
    it('TC-UA01 - happy path: replaces active allergies set', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.allergies.findMany.mockResolvedValue([
        { allergy_id: 1 },
        { allergy_id: 2 },
      ]);
      transactionMock.users_allergies.findMany.mockResolvedValue([
        {
          allergy_id: 1,
          severity: SeverityLevel.leve,
          allergies: { name: 'Polen' },
        },
        {
          allergy_id: 2,
          severity: SeverityLevel.media,
          allergies: { name: 'Lactosa' },
        },
      ]);

      const result = await service.updateAllergies('u1', {
        allergies: [
          { id: 1, severity: SeverityLevel.leve },
          { id: 2, severity: SeverityLevel.media },
        ],
      });

      expect(result.status).toBe('success');
      expect(result.message).toBe('Alergias actualizadas exitosamente');
      expect(result.data).toHaveLength(2);
    });

    it('TC-UA02 - happy path: empty list deactivates all allergies', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      transactionMock.users_allergies.findMany.mockResolvedValue([]);

      const result = await service.updateAllergies('u1', { allergies: [] });

      expect(result.status).toBe('success');
      expect(result.data).toHaveLength(0);
    });

    it('TC-UA03 - error: invalid allergy ids → BadRequestException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.allergies.findMany.mockResolvedValue([
        { allergy_id: 1 },
      ]);

      await expect(
        service.updateAllergies('u1', {
          allergies: [
            { id: 1, severity: SeverityLevel.leve },
            { id: 99, severity: SeverityLevel.alta },
          ],
        }),
      ).rejects.toMatchObject({ code: ErrorCode.USER_ALLERGY_INVALID });
    });

    it('TC-UA04 - error: user not found → NotFoundException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAllergies('missing', {
          allergies: [{ id: 1, severity: SeverityLevel.leve }],
        }),
      ).rejects.toMatchObject({ code: ErrorCode.USER_NOT_FOUND });
    });

    it('TC-UA05 - deduplicates duplicate ids before validation (last entry wins)', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.allergies.findMany.mockResolvedValue([
        { allergy_id: 3 },
      ]);
      transactionMock.users_allergies.findMany.mockResolvedValue([
        {
          allergy_id: 3,
          severity: SeverityLevel.alta,
          allergies: { name: 'Polen' },
        },
      ]);

      // duplicate id 3 — second entry (alta) wins
      const result = await service.updateAllergies('u1', {
        allergies: [
          { id: 3, severity: SeverityLevel.leve },
          { id: 3, severity: SeverityLevel.alta },
        ],
      });

      expect(result.status).toBe('success');
      expect(result.data).toHaveLength(1);
    });
  });

  // ============================================================
  // updateDiseases
  // ============================================================

  describe('updateDiseases', () => {
    it('TC-UD01 - happy path: replaces active diseases set', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.diseases.findMany.mockResolvedValue([
        { disease_id: 4 },
        { disease_id: 8 },
      ]);
      transactionMock.users_diseases.findMany.mockResolvedValue([
        {
          disease_id: 4,
          since_year: 2018,
          diseases: { name: 'Asma' },
        },
        {
          disease_id: 8,
          since_year: null,
          diseases: { name: 'Diabetes' },
        },
      ]);

      const result = await service.updateDiseases('u1', {
        diseases: [{ id: 4, since_year: 2018 }, { id: 8 }],
      });

      expect(result.status).toBe('success');
      expect(result.message).toBe('Enfermedades actualizadas exitosamente');
      expect(result.data).toHaveLength(2);
    });

    it('TC-UD02 - happy path: empty list deactivates all diseases', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      transactionMock.users_diseases.findMany.mockResolvedValue([]);

      const result = await service.updateDiseases('u1', { diseases: [] });

      expect(result.status).toBe('success');
      expect(result.data).toHaveLength(0);
    });

    it('TC-UD03 - error: invalid disease ids → BadRequestException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.diseases.findMany.mockResolvedValue([
        { disease_id: 4 },
      ]);

      await expect(
        service.updateDiseases('u1', {
          diseases: [{ id: 4 }, { id: 77 }],
        }),
      ).rejects.toMatchObject({ code: ErrorCode.USER_DISEASE_INVALID });
    });

    it('TC-UD04 - error: user not found → NotFoundException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(
        service.updateDiseases('missing', { diseases: [{ id: 4 }] }),
      ).rejects.toMatchObject({ code: ErrorCode.USER_NOT_FOUND });
    });
  });

  // ============================================================
  // removeDisease (missing not-found case)
  // ============================================================

  describe('removeDisease — not found', () => {
    it('TC-RD01 - should throw NotFoundException when disease not active for user', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_diseases.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(service.removeDisease('u1', 99)).rejects.toMatchObject({
        code: ErrorCode.USER_DISEASE_NOT_IN_PROFILE,
      });
    });
  });

  // ============================================================
  // removeMedicine (missing not-found case)
  // ============================================================

  describe('removeMedicine — not found', () => {
    it('TC-RM01 - should throw NotFoundException when medicine not active for user', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ user_id: 'u1' });
      mockPrismaService.users_medicines.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(service.removeMedicine('u1', 99)).rejects.toMatchObject({
        code: ErrorCode.USER_MEDICINE_NOT_IN_PROFILE,
      });
    });
  });

  // ============================================================
  // getMedicines — missing not-found case
  // ============================================================

  describe('getMedicines — user not found', () => {
    it('TC-GM01 - should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.getMedicines('missing')).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_FOUND,
      });
    });
  });

  // ============================================================
  // uploadProfilePicture — input validation edge cases
  // ============================================================

  describe('uploadProfilePicture — input validation', () => {
    it('TC-PP01 - error: invalid mimetype → BadRequestException', async () => {
      const file = {
        originalname: 'malware.gif',
        mimetype: 'image/gif',
        size: 1024,
        buffer: Buffer.from('gif'),
      } as Express.Multer.File;

      await expect(
        service.uploadProfilePicture('u1', file),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_IMAGE_INVALID_FORMAT,
      });
    });

    it('TC-PP02 - error: file exceeds 5MB → BadRequestException', async () => {
      const file = {
        originalname: 'big.jpeg',
        mimetype: 'image/jpeg',
        size: 6 * 1024 * 1024, // 6 MB
        buffer: Buffer.alloc(6 * 1024 * 1024),
      } as Express.Multer.File;

      await expect(
        service.uploadProfilePicture('u1', file),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_IMAGE_TOO_LARGE,
      });
    });

    it('TC-PP03 - error: user not found → NotFoundException', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      const file = {
        originalname: 'photo.jpeg',
        mimetype: 'image/jpeg',
        size: 1024,
        buffer: Buffer.from('image'),
      } as Express.Multer.File;

      await expect(
        service.uploadProfilePicture('u1', file),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_FOUND,
      });
    });
  });

  // ============================================================
  // calculateAge
  // ============================================================

  describe('calculateAge', () => {
    it('TC-CA01 - returns null when user is not found', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      const result = await service.calculateAge('missing');

      expect(result).toBeNull();
    });

    it('TC-CA02 - returns null when user has no birthday', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ birthday: null });

      const result = await service.calculateAge('u1');

      expect(result).toBeNull();
    });

    it('TC-CA03 - returns correct age when birthday already passed this year', async () => {
      // Use a fixed birthday well in the past so birthday has already passed
      // relative to today (2026-03-20). Born 2000-01-01 → 26 years old.
      mockPrismaService.users.findUnique.mockResolvedValue({
        birthday: new Date('2000-01-01'),
      });

      const result = await service.calculateAge('u1');

      expect(result).toBe(26);
    });

    it('TC-CA04 - returns correct age when birthday has not yet passed this year', async () => {
      // Born 2000-12-31 → birthday in December, before that → 25 years old on 2026-03-20
      mockPrismaService.users.findUnique.mockResolvedValue({
        birthday: new Date('2000-12-31'),
      });

      const result = await service.calculateAge('u1');

      expect(result).toBe(25);
    });
  });

  // ============================================================
  // requiresLegalRepresentative
  // ============================================================

  describe('requiresLegalRepresentative', () => {
    it('TC-RL01 - returns true for users under 18', async () => {
      // Born 2015-01-01 → 11 years old on 2026-03-20
      mockPrismaService.users.findUnique.mockResolvedValue({
        birthday: new Date('2015-01-01'),
      });

      const result = await service.requiresLegalRepresentative('u1');

      expect(result).toBe(true);
    });

    it('TC-RL02 - returns false for users 18 or older', async () => {
      // Born 2000-01-01 → 26 years old
      mockPrismaService.users.findUnique.mockResolvedValue({
        birthday: new Date('2000-01-01'),
      });

      const result = await service.requiresLegalRepresentative('u1');

      expect(result).toBe(false);
    });

    it('TC-RL03 - returns false when age is null (no birthday)', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({ birthday: null });

      const result = await service.requiresLegalRepresentative('u1');

      expect(result).toBe(false);
    });
  });
});
