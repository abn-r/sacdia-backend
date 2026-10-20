import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { SeverityLevel } from './dto/update-user-medical.dto';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import { CountryAgePolicyService } from '../common/age/country-age-policy.service';

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
    account: {
      count: jest.fn(),
    },
    guardianships: {
      count: jest.fn(),
    },
    supervised_logins: {
      createMany: jest.fn(),
    },
  };

  const mockActingForCache = {
    bump: jest.fn().mockResolvedValue(undefined),
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

  const mockCountryAgePolicy = {
    getPolicy: jest.fn(),
  };

  beforeEach(async () => {
    mockCountryAgePolicy.getPolicy.mockResolvedValue({
      minSelfLoginAge: 13,
      ageOfMajority: 18,
      timeZone: 'America/Mexico_City',
    });
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
        { provide: CountryAgePolicyService, useValue: mockCountryAgePolicy },
        { provide: ActingForCache, useValue: mockActingForCache },
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
        {
          medicine_id: 3,
          dose: '5 mg cada 8 hs',
          medicines: { name: 'Ibuprofeno' },
        },
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
        {
          medicine_id: 3,
          dose: '5 mg cada 8 hs',
          medicines: { name: 'Ibuprofeno' },
        },
        { medicine_id: 7, dose: null, medicines: { name: 'Paracetamol' } },
      ]);

      const result = await service.updateMedicines('u1', {
        medicines: [{ id: 3, dose: '5 mg cada 8 hs' }, { id: 7 }],
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
      mockPrismaService.medicines.findMany.mockResolvedValue([
        { medicine_id: 3 },
      ]);
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
      mockPrismaService.medicines.findMany.mockResolvedValue([
        { medicine_id: 3 },
      ]);

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
        {
          allergy_id: 1,
          severity: SeverityLevel.alta,
          allergies: { name: 'Polen' },
        },
        {
          allergy_id: 3,
          severity: SeverityLevel.media,
          allergies: { name: 'Penicilina' },
        },
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
      mockPrismaService.allergies.findMany.mockResolvedValue([
        { allergy_id: 5 },
      ]);
      transactionMock.users_allergies.findFirst.mockResolvedValue(null);
      transactionMock.users_allergies.findMany.mockResolvedValue([
        {
          allergy_id: 5,
          severity: SeverityLevel.alta,
          allergies: { name: 'Latex' },
        },
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
      mockPrismaService.diseases.findMany.mockResolvedValue([
        { disease_id: 4 },
      ]);
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
      mockPrismaService.diseases.findMany.mockResolvedValue([
        { disease_id: 4 },
      ]);
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

    it('TC-F05 - a linked device never selects the blood type', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        ...baseUserRow,
        user_image: null,
      });

      await service.findOne('u1', { withoutHealth: true });

      expect(mockPrismaService.users.findUnique).toHaveBeenLastCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ blood: false }),
        }),
      );
    });

    it('TC-F06 - everyone else still gets the blood type', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        ...baseUserRow,
        user_image: null,
      });

      await service.findOne('u1');

      expect(mockPrismaService.users.findUnique).toHaveBeenLastCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ blood: true }),
        }),
      );
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

    describe('date-only inputs (QA BUG-4)', () => {
      // The DTO documents YYYY-MM-DD, but Prisma rejects a date-only string for
      // a DateTime column: the raw string made PATCH /users/:id a 500.
      beforeEach(() => {
        mockPrismaService.users.findUnique.mockResolvedValue(existingUser);
        mockPrismaService.users.update.mockResolvedValue(updatedUserRow);
        mockPrismaService.unions.findUnique.mockResolvedValue({
          union_id: 2,
          country_id: 1,
        });
        mockPrismaService.local_fields.findUnique.mockResolvedValue({
          local_field_id: 3,
          union_id: 2,
        });
        mockPrismaService.account.count.mockResolvedValue(1);
      });

      it('sends a YYYY-MM-DD birthday to Prisma as a UTC-midnight Date', async () => {
        await service.update(
          'u1',
          { birthday: '2000-01-15' },
          { sub: 'u1', kind: 'user' },
        );

        const data = mockPrismaService.users.update.mock.calls[0][0].data;
        expect(data.birthday).toEqual(new Date('2000-01-15T00:00:00.000Z'));
      });

      it('sends a YYYY-MM-DD baptism_date as a UTC-midnight Date too', async () => {
        await service.update('u1', {
          baptism: true,
          baptism_date: '2015-06-20',
        });

        const data = mockPrismaService.users.update.mock.calls[0][0].data;
        expect(data.baptism_date).toEqual(new Date('2015-06-20T00:00:00.000Z'));
      });

      it('keeps the instant of a full ISO date-time (what the app sends)', async () => {
        await service.update('u1', { birthday: '2000-01-15T06:00:00.000Z' });

        const data = mockPrismaService.users.update.mock.calls[0][0].data;
        expect(data.birthday).toEqual(new Date('2000-01-15T06:00:00.000Z'));
      });

      it('leaves the other fields as they were sent', async () => {
        await service.update('u1', { gender: 'M' });

        const data = mockPrismaService.users.update.mock.calls[0][0].data;
        expect(data).toEqual({ gender: 'M' });
      });
    });

    describe('self-edit birthday age gate (FP-24)', () => {
      const yearsAgo = (years: number, extraDays = 0): string => {
        const d = new Date();
        d.setUTCFullYear(d.getUTCFullYear() - years);
        d.setUTCDate(d.getUTCDate() + extraDays);
        return d.toISOString().slice(0, 10);
      };
      const selfUser = { sub: 'u1', kind: 'user' as const };

      beforeEach(() => {
        mockPrismaService.users.findUnique.mockResolvedValue(existingUser);
        mockPrismaService.users.update.mockResolvedValue(updatedUserRow);
        mockPrismaService.unions.findUnique.mockResolvedValue({
          union_id: 2,
          country_id: 1,
        });
        mockPrismaService.local_fields.findUnique.mockResolvedValue({
          local_field_id: 3,
          union_id: 2,
        });
        mockPrismaService.account.count.mockResolvedValue(1);
      });

      it('blocks an account holder setting a 10-year-old birthday and saves nothing', async () => {
        await expect(
          service.update('u1', { birthday: yearsAgo(10) }, selfUser),
        ).rejects.toMatchObject({
          code: ErrorCode.USER_SELF_ACCOUNT_BELOW_MINIMUM_AGE,
          status: 422,
        });
        expect(mockPrismaService.users.update).not.toHaveBeenCalled();
      });

      it('gates an unknown-age account (social sign-up before step 2) the same way: a 10-year-old birthday is 422', async () => {
        await expect(
          service.update(
            'u1',
            { birthday: yearsAgo(10) },
            { sub: 'u1', kind: 'age_unknown_user' },
          ),
        ).rejects.toMatchObject({
          code: ErrorCode.USER_SELF_ACCOUNT_BELOW_MINIMUM_AGE,
          status: 422,
        });
        expect(mockPrismaService.users.update).not.toHaveBeenCalled();
      });

      it('an unknown-age account saving a 15-year-old birthday bumps the principal epoch (teen_pending right away)', async () => {
        await service.update(
          'u1',
          { birthday: yearsAgo(15) },
          { sub: 'u1', kind: 'age_unknown_user' },
        );
        expect(mockPrismaService.users.update).toHaveBeenCalled();
        expect(mockActingForCache.bump).toHaveBeenCalledWith('u1');
      });

      it('allows an account holder aged 13 or more', async () => {
        await service.update('u1', { birthday: yearsAgo(13, -1) }, selfUser);
        expect(mockPrismaService.users.update).toHaveBeenCalled();
      });

      it('uses the user country policy (min 16 blocks a 14-year-old)', async () => {
        mockCountryAgePolicy.getPolicy.mockResolvedValue({
          minSelfLoginAge: 16,
          ageOfMajority: 18,
          timeZone: 'America/Mexico_City',
        });

        await expect(
          service.update('u1', { birthday: yearsAgo(14) }, selfUser),
        ).rejects.toMatchObject({
          code: ErrorCode.USER_SELF_ACCOUNT_BELOW_MINIMUM_AGE,
        });
        expect(mockCountryAgePolicy.getPolicy).toHaveBeenCalledWith(1);
      });

      it('does not block a guardian acting for a dependent', async () => {
        await service.update(
          'u1',
          { birthday: yearsAgo(10) },
          { sub: 'u1', kind: 'guardian_acting' },
        );
        expect(mockPrismaService.users.update).toHaveBeenCalled();
        expect(mockPrismaService.account.count).not.toHaveBeenCalled();
      });

      it('does not block a third party editing another user (admin)', async () => {
        await service.update(
          'u1',
          { birthday: yearsAgo(10) },
          { sub: 'admin-1', kind: 'user' },
        );
        expect(mockPrismaService.users.update).toHaveBeenCalled();
      });

      it('does not block a target without an account (dependent)', async () => {
        mockPrismaService.account.count.mockResolvedValue(0);

        await service.update('u1', { birthday: yearsAgo(10) }, selfUser);
        expect(mockPrismaService.users.update).toHaveBeenCalled();
      });

      it('does not run when no birthday is submitted or no actor is provided', async () => {
        await service.update('u1', { gender: 'M' }, selfUser);
        await service.update('u1', { birthday: yearsAgo(10) });
        expect(mockPrismaService.account.count).not.toHaveBeenCalled();
      });
    });

    describe('supervised birthday lock and supervision sync (phase 3a)', () => {
      const yearsAgo = (years: number, extraDays = 0): string => {
        const d = new Date();
        d.setUTCFullYear(d.getUTCFullYear() - years);
        d.setUTCDate(d.getUTCDate() + extraDays);
        return d.toISOString().slice(0, 10);
      };
      const teenSelf = { sub: 'u1', kind: 'supervised_user' as const };

      beforeEach(() => {
        mockPrismaService.users.findUnique.mockResolvedValue(existingUser);
        mockPrismaService.unions.findUnique.mockResolvedValue({
          union_id: 2,
          country_id: 1,
        });
        mockPrismaService.local_fields.findUnique.mockResolvedValue({
          local_field_id: 3,
          union_id: 2,
        });
        mockPrismaService.account.count.mockResolvedValue(1);
        mockPrismaService.guardianships.count.mockResolvedValue(0);
        mockPrismaService.supervised_logins.createMany.mockResolvedValue({
          count: 1,
        });
        mockPrismaService.users.update.mockImplementation(
          ({ data }: { data: { birthday?: string } }) =>
            Promise.resolve({
              ...updatedUserRow,
              birthday: data.birthday
                ? new Date(data.birthday)
                : updatedUserRow.birthday,
            }),
        );
      });

      it('blocks a supervised teen changing THEIR OWN birthday with 422 and saves nothing', async () => {
        await expect(
          service.update('u1', { birthday: yearsAgo(20) }, teenSelf),
        ).rejects.toMatchObject({
          code: ErrorCode.USER_BIRTHDAY_CHANGE_REQUIRES_GUARDIAN,
          status: 422,
        });
        expect(mockPrismaService.users.update).not.toHaveBeenCalled();
        expect(mockActingForCache.bump).not.toHaveBeenCalled();
      });

      it('lets a supervised teen re-send their UNCHANGED birthday (post-registration step 2 save)', async () => {
        const birthday = yearsAgo(15);
        mockPrismaService.users.findUnique.mockResolvedValue({
          ...existingUser,
          birthday: new Date(`${birthday}T00:00:00.000Z`),
        });

        await service.update('u1', { birthday, gender: 'M' }, teenSelf);

        expect(mockPrismaService.users.update).toHaveBeenCalled();
      });

      it('still blocks a supervised teen whose stored birthday is unknown', async () => {
        mockPrismaService.users.findUnique.mockResolvedValue({
          ...existingUser,
          birthday: null,
        });

        await expect(
          service.update('u1', { birthday: yearsAgo(15) }, teenSelf),
        ).rejects.toMatchObject({
          code: ErrorCode.USER_BIRTHDAY_CHANGE_REQUIRES_GUARDIAN,
        });
      });

      it('lets a supervised teen edit anything else (no birthday in the body)', async () => {
        await service.update('u1', { gender: 'F' }, teenSelf);
        expect(mockPrismaService.users.update).toHaveBeenCalled();
        expect(mockActingForCache.bump).not.toHaveBeenCalled();
      });

      it('lets an admin correct the birthday of a teen', async () => {
        await service.update(
          'u1',
          { birthday: yearsAgo(15) },
          { sub: 'admin-1', kind: 'user' },
        );
        expect(mockPrismaService.users.update).toHaveBeenCalled();
      });

      it('bumps the epoch after ANY successful birthday change', async () => {
        await service.update(
          'u1',
          { birthday: yearsAgo(30) },
          { sub: 'u1', kind: 'user' },
        );
        expect(mockActingForCache.bump).toHaveBeenCalledWith('u1');
      });

      it('creates the self_registered supervised row (clock starts now) when an account holder enters 13-17', async () => {
        await service.update(
          'u1',
          { birthday: yearsAgo(15) },
          { sub: 'u1', kind: 'user' },
        );

        expect(
          mockPrismaService.supervised_logins.createMany,
        ).toHaveBeenCalledWith({
          data: [
            {
              user_id: 'u1',
              method: 'email',
              origin: 'self_registered',
              password_set_by: 'self',
              pending_since: expect.any(Date),
            },
          ],
          skipDuplicates: true,
        });
      });

      it('does not start the clock when the teen already has a guardianship', async () => {
        mockPrismaService.guardianships.count.mockResolvedValue(1);

        await service.update(
          'u1',
          { birthday: yearsAgo(15) },
          { sub: 'u1', kind: 'user' },
        );

        expect(
          mockPrismaService.supervised_logins.createMany.mock.calls[0][0]
            .data[0].pending_since,
        ).toBeNull();
      });

      it('is idempotent: skipDuplicates covers an existing row', async () => {
        await service.update(
          'u1',
          { birthday: yearsAgo(15) },
          { sub: 'u1', kind: 'user' },
        );
        await service.update(
          'u1',
          { birthday: yearsAgo(16) },
          { sub: 'u1', kind: 'user' },
        );

        for (const call of mockPrismaService.supervised_logins.createMany.mock
          .calls) {
          expect(call[0].skipDuplicates).toBe(true);
        }
      });

      it.each([
        ['an adult', yearsAgo(30)],
        ['a child below the minimum age', yearsAgo(10)],
      ])('creates no row for %s', async (_label, birthday) => {
        await service.update(
          'u1',
          { birthday },
          { sub: 'admin-1', kind: 'user' },
        );
        expect(
          mockPrismaService.supervised_logins.createMany,
        ).not.toHaveBeenCalled();
      });

      it('creates no row for a user without an account (dependent)', async () => {
        mockPrismaService.account.count.mockResolvedValue(0);

        await service.update(
          'u1',
          { birthday: yearsAgo(15) },
          { sub: 'guardian-1', kind: 'guardian_acting' },
        );

        expect(
          mockPrismaService.supervised_logins.createMany,
        ).not.toHaveBeenCalled();
        expect(mockActingForCache.bump).toHaveBeenCalledWith('u1');
      });

      it('a failure syncing the supervised row never fails the update (still bumps the epoch)', async () => {
        mockPrismaService.supervised_logins.createMany.mockRejectedValue(
          new Error('db down'),
        );

        await expect(
          service.update(
            'u1',
            { birthday: yearsAgo(15) },
            { sub: 'u1', kind: 'user' },
          ),
        ).resolves.toMatchObject({ status: 'success' });
        expect(mockActingForCache.bump).toHaveBeenCalledWith('u1');
      });
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

    it('TC-U04 - security: rejects self-service country changes before validation', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(existingUser);

      await expect(
        service.update('u1', { country_id: 999 }),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_PROFILE_GEOGRAPHY_READ_ONLY,
      });
      expect(mockPrismaService.countries.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaService.users.update).not.toHaveBeenCalled();
    });

    it('TC-U05 - security: rejects self-service union changes before validation', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(existingUser);

      await expect(
        service.update('u1', { union_id: 999 }),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_PROFILE_GEOGRAPHY_READ_ONLY,
      });
      expect(mockPrismaService.unions.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaService.users.update).not.toHaveBeenCalled();
    });

    it('TC-U06 - security: rejects self-service local-field changes before validation', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(existingUser);

      await expect(
        service.update('u1', { local_field_id: 999 }),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_PROFILE_GEOGRAPHY_READ_ONLY,
      });
      expect(mockPrismaService.local_fields.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaService.users.update).not.toHaveBeenCalled();
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

    describe('country age of majority', () => {
      beforeEach(() => {
        jest.useFakeTimers({ now: new Date('2026-10-16T18:00:00.000Z') });
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('TC-RL04 - a 17-year-old requires a representative when the majority is 18', async () => {
        mockPrismaService.users.findUnique.mockResolvedValue({
          birthday: new Date('2009-05-10'),
          country_id: 1,
        });

        await expect(service.requiresLegalRepresentative('u1')).resolves.toBe(
          true,
        );
        expect(mockCountryAgePolicy.getPolicy).toHaveBeenCalledWith(1);
      });

      it('TC-RL05 - a 17-year-old does not require one when the country majority is 16', async () => {
        mockCountryAgePolicy.getPolicy.mockResolvedValue({
          minSelfLoginAge: 13,
          ageOfMajority: 16,
          timeZone: 'America/Mexico_City',
        });
        mockPrismaService.users.findUnique.mockResolvedValue({
          birthday: new Date('2009-05-10'),
          country_id: 2,
        });

        await expect(service.requiresLegalRepresentative('u1')).resolves.toBe(
          false,
        );
      });

      it('TC-RL06 - age uses the calendar of the country reference zone', async () => {
        // 18:00Z on Oct 16 is Oct 16 in Mexico City but already Oct 17 in Auckland.
        mockCountryAgePolicy.getPolicy.mockResolvedValue({
          minSelfLoginAge: 13,
          ageOfMajority: 18,
          timeZone: 'Pacific/Auckland',
        });
        mockPrismaService.users.findUnique.mockResolvedValue({
          birthday: new Date('2008-10-17'),
          country_id: 3,
        });

        await expect(service.calculateAge('u1')).resolves.toBe(18);
        await expect(service.requiresLegalRepresentative('u1')).resolves.toBe(
          false,
        );
      });
    });
  });
});
