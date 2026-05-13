import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  AllergyEntryDto,
  DiseaseEntryDto,
  MedicineEntryDto,
  UpdateUserAllergiesDto,
  UpdateUserDiseasesDto,
  UpdateUserMedicinesDto,
} from './dto/update-user-medical.dto';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;

  constructor(
    private prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  private async ensureUserExists(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    return user;
  }

  private async validateGeographyReferences(
    updateUserDto: UpdateUserDto,
    currentUser: {
      country_id: number | null;
      union_id: number | null;
      local_field_id: number | null;
    },
  ) {
    let selectedUnion: {
      union_id: number;
      country_id: number;
    } | null = null;

    if (updateUserDto.country_id !== undefined) {
      const country = await this.prisma.countries.findFirst({
        where: { country_id: updateUserDto.country_id, active: true },
        select: { country_id: true },
      });
      if (!country) {
        throw new AppBadRequestException(ErrorCode.USER_COUNTRY_INVALID);
      }
    }

    if (updateUserDto.union_id !== undefined) {
      selectedUnion = await this.prisma.unions.findFirst({
        where: { union_id: updateUserDto.union_id, active: true },
        select: { union_id: true, country_id: true },
      });
      if (!selectedUnion) {
        throw new AppBadRequestException(ErrorCode.USER_UNION_INVALID);
      }
    }

    if (updateUserDto.local_field_id !== undefined) {
      const localField = await this.prisma.local_fields.findFirst({
        where: { local_field_id: updateUserDto.local_field_id, active: true },
        select: { local_field_id: true },
      });
      if (!localField) {
        throw new AppBadRequestException(ErrorCode.USER_LOCAL_FIELD_INVALID);
      }
    }

    const targetCountryId = updateUserDto.country_id ?? currentUser.country_id;
    const targetUnionId = updateUserDto.union_id ?? currentUser.union_id;

    if (targetCountryId !== null && targetUnionId !== null) {
      if (!selectedUnion || selectedUnion.union_id !== targetUnionId) {
        selectedUnion = await this.prisma.unions.findUnique({
          where: { union_id: targetUnionId },
          select: { union_id: true, country_id: true },
        });
      }

      if (!selectedUnion || selectedUnion.country_id !== targetCountryId) {
        throw new AppBadRequestException(ErrorCode.USER_UNION_COUNTRY_MISMATCH);
      }
    }

    const targetLocalFieldId =
      updateUserDto.local_field_id ?? currentUser.local_field_id;

    if (targetLocalFieldId !== null && targetUnionId !== null) {
      const localField = await this.prisma.local_fields.findUnique({
        where: { local_field_id: targetLocalFieldId },
        select: { local_field_id: true, union_id: true },
      });

      if (!localField || localField.union_id !== targetUnionId) {
        throw new AppBadRequestException(
          ErrorCode.USER_LOCAL_FIELD_UNION_MISMATCH,
        );
      }
    }
  }

  private async validateAllergiesExist(allergyIds: number[]) {
    if (!allergyIds.length) return;

    const rows = await this.prisma.allergies.findMany({
      where: {
        allergy_id: { in: allergyIds },
        active: true,
      },
      select: { allergy_id: true },
    });

    const found = new Set(rows.map((row) => row.allergy_id));
    const invalid = allergyIds.filter((id) => !found.has(id));

    if (invalid.length > 0) {
      throw new AppBadRequestException(ErrorCode.USER_ALLERGY_INVALID, {
        ids: invalid.join(', '),
      });
    }
  }

  private async validateDiseasesExist(diseaseIds: number[]) {
    if (!diseaseIds.length) return;

    const rows = await this.prisma.diseases.findMany({
      where: {
        disease_id: { in: diseaseIds },
        active: true,
      },
      select: { disease_id: true },
    });

    const found = new Set(rows.map((row) => row.disease_id));
    const invalid = diseaseIds.filter((id) => !found.has(id));

    if (invalid.length > 0) {
      throw new AppBadRequestException(ErrorCode.USER_DISEASE_INVALID, {
        ids: invalid.join(', '),
      });
    }
  }

  private async validateAllergyEntriesExist(entries: AllergyEntryDto[]) {
    await this.validateAllergiesExist(entries.map((e) => e.id));
  }

  private async validateDiseaseEntriesExist(entries: DiseaseEntryDto[]) {
    await this.validateDiseasesExist(entries.map((e) => e.id));
  }

  private async validateMedicineEntriesExist(entries: MedicineEntryDto[]) {
    await this.validateMedicinesExist(entries.map((e) => e.id));
  }

  private async validateMedicinesExist(medicineIds: number[]) {
    if (!medicineIds.length) return;

    const rows = await this.prisma.medicines.findMany({
      where: {
        medicine_id: { in: medicineIds },
        active: true,
      },
      select: { medicine_id: true },
    });

    const found = new Set(rows.map((row) => row.medicine_id));
    const invalid = medicineIds.filter((id) => !found.has(id));

    if (invalid.length > 0) {
      throw new AppBadRequestException(ErrorCode.USER_MEDICINE_INVALID, {
        ids: invalid.join(', '),
      });
    }
  }

  async findOne(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        gender: true,
        birthday: true,
        baptism: true,
        baptism_date: true,
        blood: true,
        user_image: true,
        country_id: true,
        union_id: true,
        local_field_id: true,
        access_app: true,
        access_panel: true,
        created_at: true,
        modified_at: true,
      },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    if (user.user_image) {
      user.user_image = await this.resolvePrivateAssetUrl(
        StorageBucketAlias.USER_PROFILES,
        user.user_image,
      );
    }

    return { status: 'success', data: user };
  }

  async update(userId: string, updateUserDto: UpdateUserDto) {
    // Validar que el usuario existe
    const existingUser = await this.ensureUserExists(userId);

    // Validar baptism_date solo si baptism es true
    if (updateUserDto.baptism === false && updateUserDto.baptism_date) {
      throw new AppBadRequestException(ErrorCode.USER_BAPTISM_DATE_CONFLICT);
    }

    await this.validateGeographyReferences(updateUserDto, existingUser);

    const updatedUser = await this.prisma.users.update({
      where: { user_id: userId },
      data: updateUserDto,
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        gender: true,
        birthday: true,
        baptism: true,
        baptism_date: true,
        blood: true,
        country_id: true,
        union_id: true,
        local_field_id: true,
        modified_at: true,
      },
    });

    this.logger.log(`User updated: ${userId}`);

    return {
      status: 'success',
      data: updatedUser,
      message: 'Usuario actualizado exitosamente',
    };
  }

  async getAllergies(userId: string) {
    await this.ensureUserExists(userId);

    const data = await this.prisma.users_allergies.findMany({
      where: {
        user_id: userId,
        active: true,
      },
      select: {
        allergy_id: true,
        severity: true,
        allergies: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { allergy_id: 'asc' },
    });

    return {
      status: 'success',
      data: data.map((row) => ({
        allergy_id: row.allergy_id,
        name: row.allergies ? row.allergies.name : null,
        severity: row.severity,
      })),
    };
  }

  async getDiseases(userId: string) {
    await this.ensureUserExists(userId);

    const data = await this.prisma.users_diseases.findMany({
      where: {
        user_id: userId,
        active: true,
      },
      select: {
        disease_id: true,
        since_year: true,
        diseases: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { disease_id: 'asc' },
    });

    return {
      status: 'success',
      data: data.map((row) => ({
        disease_id: row.disease_id,
        name: row.diseases.name,
        since_year: row.since_year,
      })),
    };
  }

  async getMedicines(userId: string) {
    await this.ensureUserExists(userId);

    const data = await this.prisma.users_medicines.findMany({
      where: {
        user_id: userId,
        active: true,
      },
      select: {
        medicine_id: true,
        dose: true,
        medicines: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { medicine_id: 'asc' },
    });

    return {
      status: 'success',
      data: data.map((row) => ({
        medicine_id: row.medicine_id,
        name: row.medicines.name,
        dose: row.dose,
      })),
    };
  }

  async updateAllergies(userId: string, dto: UpdateUserAllergiesDto) {
    await this.ensureUserExists(userId);

    // Deduplicate by id, last entry wins for severity
    const uniqueEntries = [
      ...new Map(dto.allergies.map((e) => [e.id, e])).values(),
    ];
    await this.validateAllergyEntriesExist(uniqueEntries);

    const data = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const incomingIds = uniqueEntries.map((e) => e.id);

      // Soft-delete active rows not present in incoming list
      await tx.users_allergies.updateMany({
        where: {
          user_id: userId,
          active: true,
          ...(incomingIds.length > 0
            ? { allergy_id: { notIn: incomingIds } }
            : {}),
        },
        data: {
          active: false,
          modified_at: now,
        },
      });

      // Upsert each entry: reactivate + update severity if exists, else create
      for (const entry of uniqueEntries) {
        const existing = await tx.users_allergies.findFirst({
          where: {
            user_id: userId,
            allergy_id: entry.id,
          },
          select: { user_allergies_id: true },
        });

        if (existing) {
          await tx.users_allergies.update({
            where: { user_allergies_id: existing.user_allergies_id },
            data: {
              active: true,
              severity: entry.severity,
              modified_at: now,
            },
          });
        } else {
          await tx.users_allergies.create({
            data: {
              user_id: userId,
              allergy_id: entry.id,
              severity: entry.severity,
              active: true,
            },
          });
        }
      }

      return tx.users_allergies.findMany({
        where: {
          user_id: userId,
          active: true,
        },
        select: {
          allergy_id: true,
          severity: true,
          allergies: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { allergy_id: 'asc' },
      });
    });

    this.logger.log(`User allergies updated: ${userId}`);

    return {
      status: 'success',
      data: data.map((row) => ({
        allergy_id: row.allergy_id,
        name: row.allergies ? row.allergies.name : null,
        severity: row.severity,
      })),
      message: 'Alergias actualizadas exitosamente',
    };
  }

  async updateDiseases(userId: string, dto: UpdateUserDiseasesDto) {
    await this.ensureUserExists(userId);

    // Deduplicate by id, last entry wins
    const uniqueEntries = [
      ...new Map(dto.diseases.map((e) => [e.id, e])).values(),
    ];
    await this.validateDiseaseEntriesExist(uniqueEntries);

    const data = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const incomingIds = uniqueEntries.map((e) => e.id);

      // Soft-delete active rows not present in incoming list
      await tx.users_diseases.updateMany({
        where: {
          user_id: userId,
          active: true,
          ...(incomingIds.length > 0
            ? { disease_id: { notIn: incomingIds } }
            : {}),
        },
        data: {
          active: false,
          modified_at: now,
        },
      });

      // Upsert each entry: reactivate + update since_year if exists, else create
      for (const entry of uniqueEntries) {
        const existing = await tx.users_diseases.findFirst({
          where: {
            user_id: userId,
            disease_id: entry.id,
          },
          select: { user_disease_id: true },
        });

        if (existing) {
          await tx.users_diseases.update({
            where: { user_disease_id: existing.user_disease_id },
            data: {
              active: true,
              since_year: entry.since_year ?? null,
              modified_at: now,
            },
          });
        } else {
          await tx.users_diseases.create({
            data: {
              user_id: userId,
              disease_id: entry.id,
              since_year: entry.since_year ?? null,
              active: true,
            },
          });
        }
      }

      return tx.users_diseases.findMany({
        where: {
          user_id: userId,
          active: true,
        },
        select: {
          disease_id: true,
          since_year: true,
          diseases: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { disease_id: 'asc' },
      });
    });

    this.logger.log(`User diseases updated: ${userId}`);

    return {
      status: 'success',
      data: data.map((row) => ({
        disease_id: row.disease_id,
        name: row.diseases.name,
        since_year: row.since_year,
      })),
      message: 'Enfermedades actualizadas exitosamente',
    };
  }

  async updateMedicines(userId: string, dto: UpdateUserMedicinesDto) {
    await this.ensureUserExists(userId);

    // Deduplicate by id, last entry wins
    const uniqueEntries = [
      ...new Map(dto.medicines.map((e) => [e.id, e])).values(),
    ];
    await this.validateMedicineEntriesExist(uniqueEntries);

    const data = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const incomingIds = uniqueEntries.map((e) => e.id);

      // Soft-delete active rows not present in incoming list
      await tx.users_medicines.updateMany({
        where: {
          user_id: userId,
          active: true,
          ...(incomingIds.length > 0
            ? { medicine_id: { notIn: incomingIds } }
            : {}),
        },
        data: {
          active: false,
          modified_at: now,
        },
      });

      // Upsert each entry: reactivate + update dose if exists, else create
      for (const entry of uniqueEntries) {
        const existing = await tx.users_medicines.findFirst({
          where: {
            user_id: userId,
            medicine_id: entry.id,
          },
          select: { user_medicine_id: true },
        });

        if (existing) {
          await tx.users_medicines.update({
            where: { user_medicine_id: existing.user_medicine_id },
            data: {
              active: true,
              dose: entry.dose ?? null,
              modified_at: now,
            },
          });
        } else {
          await tx.users_medicines.create({
            data: {
              user_id: userId,
              medicine_id: entry.id,
              dose: entry.dose ?? null,
              active: true,
            },
          });
        }
      }

      return tx.users_medicines.findMany({
        where: {
          user_id: userId,
          active: true,
        },
        select: {
          medicine_id: true,
          dose: true,
          medicines: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { medicine_id: 'asc' },
      });
    });

    this.logger.log(`User medicines updated: ${userId}`);

    return {
      status: 'success',
      data: data.map((row) => ({
        medicine_id: row.medicine_id,
        name: row.medicines.name,
        dose: row.dose,
      })),
      message: 'Medicamentos actualizados exitosamente',
    };
  }

  async removeAllergy(userId: string, allergyId: number) {
    await this.ensureUserExists(userId);

    const now = new Date();
    const result = await this.prisma.users_allergies.updateMany({
      where: {
        user_id: userId,
        allergy_id: allergyId,
        active: true,
      },
      data: {
        active: false,
        modified_at: now,
      },
    });

    if (result.count === 0) {
      throw new AppNotFoundException(ErrorCode.USER_ALLERGY_NOT_IN_PROFILE);
    }

    this.logger.log(`User allergy removed: ${userId} -> ${allergyId}`);

    return {
      status: 'success',
      data: {
        allergy_id: allergyId,
        active: false,
      },
      message: 'Alergia eliminada exitosamente',
    };
  }

  async removeDisease(userId: string, diseaseId: number) {
    await this.ensureUserExists(userId);

    const now = new Date();
    const result = await this.prisma.users_diseases.updateMany({
      where: {
        user_id: userId,
        disease_id: diseaseId,
        active: true,
      },
      data: {
        active: false,
        modified_at: now,
      },
    });

    if (result.count === 0) {
      throw new AppNotFoundException(ErrorCode.USER_DISEASE_NOT_IN_PROFILE);
    }

    this.logger.log(`User disease removed: ${userId} -> ${diseaseId}`);

    return {
      status: 'success',
      data: {
        disease_id: diseaseId,
        active: false,
      },
      message: 'Enfermedad eliminada exitosamente',
    };
  }

  async removeMedicine(userId: string, medicineId: number) {
    await this.ensureUserExists(userId);

    const now = new Date();
    const result = await this.prisma.users_medicines.updateMany({
      where: {
        user_id: userId,
        medicine_id: medicineId,
        active: true,
      },
      data: {
        active: false,
        modified_at: now,
      },
    });

    if (result.count === 0) {
      throw new AppNotFoundException(ErrorCode.USER_MEDICINE_NOT_IN_PROFILE);
    }

    this.logger.log(`User medicine removed: ${userId} -> ${medicineId}`);

    return {
      status: 'success',
      data: {
        medicine_id: medicineId,
        active: false,
      },
      message: 'Medicamento eliminado exitosamente',
    };
  }

  async uploadProfilePicture(userId: string, file: Express.Multer.File) {
    // Validar formato
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new AppBadRequestException(ErrorCode.USER_IMAGE_INVALID_FORMAT);
    }

    // Validar tamaño (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new AppBadRequestException(ErrorCode.USER_IMAGE_TOO_LARGE, {
        max_mb: '5',
      });
    }

    // Determinar extensión
    const extension = file.mimetype.split('/')[1];
    const fileName = `photo-${userId}-${Date.now()}.${extension}`;

    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { user_image: true },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    let uploaded: { key: string; url: string };

    try {
      uploaded = await this.fileStorage.upload(
        StorageBucketAlias.USER_PROFILES,
        fileName,
        file.buffer,
        {
          contentType: file.mimetype,
        },
      );
    } catch (error) {
      this.logger.error('R2 upload error:', error);
      throw new AppInternalServerErrorException(
        ErrorCode.USER_IMAGE_UPLOAD_FAILED,
      );
    }

    try {
      await this.prisma.users.update({
        where: { user_id: userId },
        data: { user_image: uploaded.url },
      });
    } catch (error) {
      this.logger.error('Database update failed after upload:', error);
      await this.rollbackUploadedObjects(StorageBucketAlias.USER_PROFILES, [
        uploaded.key,
      ]);
      throw new AppInternalServerErrorException(
        ErrorCode.USER_IMAGE_UPDATE_FAILED,
      );
    }

    // Fire-and-forget: do NOT await — old-file cleanup must not block the
    // response or risk rolling back an already-committed DB row.
    // Failures are logged at WARN level for manual sweeps.
    this.cleanupPreviousProfilePicture(user.user_image, uploaded.key).catch(
      (err: unknown) => {
        this.logger.warn(
          `Unexpected error during profile picture cleanup for user ${userId}`,
          err,
        );
      },
    );

    this.logger.log(`Profile picture uploaded for user: ${userId}`);

    return {
      status: 'success',
      data: {
        url: await this.resolvePrivateAssetUrl(
          StorageBucketAlias.USER_PROFILES,
          uploaded.url,
        ),
        fileName,
      },
      message: 'Foto de perfil actualizada exitosamente',
    };
  }

  async deleteProfilePicture(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { user_image: true },
    });

    if (!user) {
      throw new AppNotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    if (!user.user_image) {
      throw new AppBadRequestException(ErrorCode.USER_NO_PROFILE_PICTURE);
    }

    const fileKey = this.fileStorage.extractKeyFromPublicUrl(
      StorageBucketAlias.USER_PROFILES,
      user.user_image,
    );

    const previousUrl = user.user_image;

    try {
      await this.prisma.users.update({
        where: { user_id: userId },
        data: { user_image: null },
      });
    } catch (error) {
      this.logger.error(
        'Database update failed while deleting profile image:',
        error,
      );
      throw new AppInternalServerErrorException(
        ErrorCode.USER_IMAGE_DELETE_FAILED,
      );
    }

    if (fileKey) {
      try {
        await this.fileStorage.deleteMany(StorageBucketAlias.USER_PROFILES, [
          fileKey,
        ]);
      } catch (error) {
        this.logger.error('R2 delete error:', error);

        try {
          await this.prisma.users.update({
            where: { user_id: userId },
            data: { user_image: previousUrl },
          });
        } catch (restoreError) {
          this.logger.error(
            'Critical: failed to restore DB after R2 delete error',
            restoreError,
          );
        }

        throw new AppInternalServerErrorException(
          ErrorCode.USER_IMAGE_DELETE_FAILED,
        );
      }
    } else {
      this.logger.warn(
        `Skipping remote delete for legacy/non-R2 URL: ${user.user_image}`,
      );
    }

    this.logger.log(`Profile picture deleted for user: ${userId}`);

    return {
      status: 'success',
      message: 'Foto de perfil eliminada exitosamente',
    };
  }

  async calculateAge(userId: string): Promise<number | null> {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { birthday: true },
    });

    if (!user || !user.birthday) {
      return null;
    }

    const today = new Date();
    const birthDate = new Date(user.birthday);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  }

  async requiresLegalRepresentative(userId: string): Promise<boolean> {
    const age = await this.calculateAge(userId);
    return age !== null && age < 18;
  }

  private async rollbackUploadedObjects(
    bucketAlias: StorageBucketAlias,
    keys: string[],
  ) {
    if (keys.length === 0) return;

    try {
      await this.fileStorage.deleteMany(bucketAlias, keys);
    } catch (error) {
      this.logger.error(
        `Critical: failed to rollback uploaded objects in ${bucketAlias}`,
        error,
      );
    }
  }

  private async cleanupPreviousProfilePicture(
    previousUrl: string | null | undefined,
    newKey: string,
  ) {
    if (!previousUrl) return;

    const previousKey = this.fileStorage.extractKeyFromPublicUrl(
      StorageBucketAlias.USER_PROFILES,
      previousUrl,
    );

    if (!previousKey || previousKey === newKey) return;

    try {
      await this.fileStorage.deleteMany(StorageBucketAlias.USER_PROFILES, [
        previousKey,
      ]);
    } catch (error) {
      this.logger.warn(
        `Best-effort cleanup failed for old profile picture: ${previousKey}`,
        error,
      );
    }
  }

  private async resolvePrivateAssetUrl(
    bucketAlias: StorageBucketAlias,
    value: string | null | undefined,
  ): Promise<string | null> {
    if (!value) return null;

    try {
      return await this.fileStorage.getSignedDownloadUrl(bucketAlias, value, {
        expiresInSeconds: UsersService.PRIVATE_ASSET_URL_TTL_SECONDS,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to generate signed URL for ${bucketAlias}. Returning original value.`,
        error,
      );
      return value;
    }
  }
}
