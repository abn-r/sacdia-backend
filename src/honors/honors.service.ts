import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  StartHonorDto,
  UpdateUserHonorDto,
  HonorFiltersDto,
  CreateUserHonorDto,
  BulkCreateUserHonorsDto,
} from './dto';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { TranslationService } from '../common/services/translation.service';
import { AchievementsService } from '../achievements/achievements.service';
import pLimit from 'p-limit';

// Cap concurrent presign calls for USERS_HONORS bucket images. A single honor
// detail request resolves certificate + document + N image URLs. Without the
// cap, a bulk getUserHonors response (up to 500 honors × N images each) would
// fire thousands of simultaneous HMAC presigns. Cap is 20, matching the pattern
// used by PROFILE_URL_LIMITER in camporees.service.ts.
export const HONOR_DETAIL_URL_LIMITER = pLimit(20);

type UploadedObjectRef = {
  bucketAlias: StorageBucketAlias;
  key: string;
};

@Injectable()
export class HonorsService {
  private readonly logger = new Logger(HonorsService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly achievementsService: AchievementsService,
    private readonly translationService: TranslationService,
  ) {}

  // ========================================
  // CATÁLOGO DE HONORES
  // ========================================

  async findAll(
    filters?: HonorFiltersDto,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<any>> {
    const locale = this.translationService.getCurrentLocale();
    const where = {
      active: true,
      ...(filters?.categoryId && { honors_category_id: filters.categoryId }),
      ...(filters?.clubTypeId && { club_type_id: filters.clubTypeId }),
      ...(filters?.skillLevel && { skill_level: filters.skillLevel }),
    };

    const [data, total] = await Promise.all([
      this.prisma.honors.findMany({
        where,
        include: {
          honors_categories: { select: { name: true, icon: true } },
          club_types: { select: { name: true } },
          translations: {
            where: { locale },
            select: { locale: true, name: true, description: true },
          },
        },
        orderBy: [{ honors_category_id: 'asc' }, { name: 'asc' }],
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 50,
      }),
      this.prisma.honors.count({ where }),
    ]);

    const translated = this.translationService.translateMany(
      data,
      locale,
      ['name', 'description'],
      'translations',
    );

    return createPaginatedResult(
      translated,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  async getGroupedByCategory(filters?: HonorFiltersDto) {
    const locale = this.translationService.getCurrentLocale();
    const where = {
      active: true,
      ...(filters?.categoryId && { honors_category_id: filters.categoryId }),
      ...(filters?.clubTypeId && { club_type_id: filters.clubTypeId }),
      ...(filters?.skillLevel && { skill_level: filters.skillLevel }),
    };

    // Safety cap: the honors catalog is expected to stay in the low thousands.
    // A take of 2000 prevents a full-table scan if the catalog grows unexpectedly.
    const honors = await this.prisma.honors.findMany({
      where,
      select: {
        honor_id: true,
        name: true,
        description: true,
        honor_image: true,
        skill_level: true,
        material_url: true,
        club_type_id: true,
        honors_category_id: true,
        translations: {
          where: { locale },
          select: { locale: true, name: true, description: true },
        },
        honors_categories: {
          select: {
            honor_category_id: true,
            name: true,
            description: true,
            icon: true,
          },
        },
        club_types: { select: { name: true } },
      },
      orderBy: [{ honors_category_id: 'asc' }, { name: 'asc' }],
      take: 2000,
    });

    const grouped = new Map<
      string,
      {
        category: {
          honor_category_id: number | null;
          name: string;
          description: string | null;
          icon: number | null;
        };
        honors: Array<{
          honor_id: number;
          name: string;
          description: string | null;
          honor_image: string | null;
          skill_level: number | null;
          material_url: string | null;
          club_type_id: number | null;
          club_type_name: string | null;
        }>;
      }
    >();

    // Apply translations to honors before grouping
    const translatedHonors = this.translationService.translateMany(
      honors,
      locale,
      ['name', 'description'],
      'translations',
    );

    for (const honor of translatedHonors as any[]) {
      const category = honor.honors_categories;
      const key = category?.honor_category_id
        ? String(category.honor_category_id)
        : 'uncategorized';

      if (!grouped.has(key)) {
        grouped.set(key, {
          category: category
            ? {
                honor_category_id: category.honor_category_id,
                name: category.name,
                description: category.description,
                icon: category.icon,
              }
            : {
                honor_category_id: null,
                name: 'Sin categoría',
                description: null,
                icon: null,
              },
          honors: [],
        });
      }

      grouped.get(key)!.honors.push({
        honor_id: honor.honor_id,
        name: honor.name,
        description: honor.description,
        honor_image: honor.honor_image,
        skill_level: honor.skill_level,
        material_url: honor.material_url,
        club_type_id: honor.club_type_id,
        club_type_name: honor.club_types?.name ?? null,
      });
    }

    return Array.from(grouped.values());
  }

  async findOne(honorId: number) {
    const locale = this.translationService.getCurrentLocale();
    const honor = await this.prisma.honors.findUnique({
      where: { honor_id: honorId, active: true },
      include: {
        honors_categories: true,
        club_types: { select: { name: true } },
        master_honors: {
          select: {
            name: true,
            translations: {
              where: { locale },
              select: { locale: true, name: true },
            },
          },
        },
        translations: {
          where: { locale },
          select: { locale: true, name: true, description: true },
        },
      },
    });

    if (!honor) {
      throw new AppNotFoundException(ErrorCode.HONOR_NOT_FOUND);
    }

    // Translate honor
    const translatedHonor = this.translationService.translateMany(
      [honor],
      locale,
      ['name', 'description'],
      'translations',
    )[0];

    // Translate master_honor name if present
    if (translatedHonor.master_honors) {
      const masterTranslated = this.translationService.translateMany(
        [translatedHonor.master_honors],
        locale,
        ['name'],
        'translations',
      )[0];
      (translatedHonor as any).master_honors = masterTranslated;
    }

    return translatedHonor;
  }

  async getCategories() {
    // Small catalog table: expected to remain under ~100 rows.
    // No pagination needed; a safety cap is applied as a precaution.
    //
    // Approach X i18n: Spanish (es) lives in main table columns.
    // For non-es locales, JOIN honors_categories_translations and overlay fields.
    // If no translation row exists for the requested locale, fall back to Spanish.
    const locale = this.translationService.getCurrentLocale();

    const records = await this.prisma.honors_categories.findMany({
      where: { active: true },
      select: {
        honor_category_id: true,
        name: true,
        description: true,
        icon: true,
        translations: {
          where: { locale },
          select: { locale: true, name: true, description: true },
        },
      },
      orderBy: { name: 'asc' },
      take: 200,
    });

    return this.translationService.translateMany(
      records,
      locale,
      ['name', 'description'],
      'translations',
    );
  }

  // ========================================
  // HONORES DE USUARIO
  // ========================================

  async getUserHonors(userId: string, validated?: boolean) {
    // A single user is not expected to have more than a few hundred honors.
    // The cap of 500 prevents unbounded growth from becoming a problem.
    const honors = await this.prisma.users_honors.findMany({
      where: {
        user_id: userId,
        active: true,
        ...(validated !== undefined && { validate: validated }),
      },
      include: {
        honors: {
          select: {
            honor_id: true,
            name: true,
            honor_image: true,
            skill_level: true,
            honors_categories: { select: { name: true, icon: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 500,
    });

    return Promise.all(
      honors.map((userHonor) =>
        HONOR_DETAIL_URL_LIMITER(() => this.mapUserHonorPrivateUrls(userHonor)),
      ),
    );
  }

  async startHonor(userId: string, honorId: number, dto?: StartHonorDto) {
    // Verificar que el honor existe y está activo
    const honor = await this.findOne(honorId);

    // Buscar si existe un registro previo (activo o inactivo)
    const existing = await this.prisma.users_honors.findFirst({
      where: {
        user_id: userId,
        honor_id: honorId,
      },
    });

    // Si ya está activo, rechazar
    if (existing && existing.active) {
      throw new AppConflictException(ErrorCode.HONOR_USER_ALREADY_IN_PROGRESS);
    }

    // Si existe pero está inactivo, reactivar; si no, crear nuevo
    if (existing) {
      const updated = await this.prisma.users_honors.update({
        where: { user_honor_id: existing.user_honor_id },
        data: {
          active: true,
          date: dto?.date ? new Date(dto.date) : new Date(),
          validate: false,
          validation_status: 'IN_PROGRESS',
          certificate: '',
          images: [],
          document: null,
          submitted_at: null,
          validated_by_id: null,
          validated_at: null,
          rejection_reason: null,
          modified_at: new Date(),
        },
        include: {
          honors: {
            select: {
              name: true,
              honor_image: true,
              honors_categories: { select: { name: true } },
            },
          },
        },
      });

      try {
        await this.achievementsService.emitEvent({
          userId,
          eventType: 'honor.started',
          payload: {
            honor_id: honor.honor_id,
            category_id: honor.honors_category_id,
            honor_name: honor.name,
            club_type_id: honor.club_type_id,
          },
        });
      } catch (error) {
        this.logger.warn(`Failed to emit achievement event: ${(error as Error).message}`);
      }

      return this.mapUserHonorPrivateUrls(updated);
    }

    // Crear nuevo registro
    const created = await this.prisma.users_honors.create({
      data: {
        user_id: userId,
        honor_id: honorId,
        date: dto?.date ? new Date(dto.date) : new Date(),
        validate: false,
        validation_status: 'IN_PROGRESS',
        certificate: '',
        images: [],
        active: true,
      },
      include: {
        honors: {
          select: {
            name: true,
            honor_image: true,
            honors_categories: { select: { name: true } },
          },
        },
      },
    });

    try {
      await this.achievementsService.emitEvent({
        userId,
        eventType: 'honor.started',
        payload: {
          honor_id: honor.honor_id,
          category_id: honor.honors_category_id,
          honor_name: honor.name,
          club_type_id: honor.club_type_id,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to emit achievement event: ${(error as Error).message}`);
    }

    return this.mapUserHonorPrivateUrls(created);
  }

  async createUserHonor(userId: string, dto: CreateUserHonorDto) {
    await this.findOne(dto.honorId);

    const existing = await this.prisma.users_honors.findFirst({
      where: {
        user_id: userId,
        honor_id: dto.honorId,
      },
      select: {
        user_honor_id: true,
      },
    });

    if (existing) {
      const updated = await this.prisma.users_honors.update({
        where: { user_honor_id: existing.user_honor_id },
        data: this.buildUpdateDataFromCreateDto(dto),
        include: {
          honors: {
            select: {
              honor_id: true,
              name: true,
              honor_image: true,
              honors_categories: { select: { name: true } },
            },
          },
        },
      });

      return this.mapUserHonorPrivateUrls(updated);
    }

    const created = await this.prisma.users_honors.create({
      data: {
        user_id: userId,
        honor_id: dto.honorId,
        ...this.buildCreateDataFromCreateDto(dto),
      },
      include: {
        honors: {
          select: {
            honor_id: true,
            name: true,
            honor_image: true,
            honors_categories: { select: { name: true } },
          },
        },
      },
    });

    return this.mapUserHonorPrivateUrls(created);
  }

  async createUserHonorsBulk(userId: string, dto: BulkCreateUserHonorsDto) {
    const honorIds = dto.honors.map((item) => item.honorId);

    const seen = new Set<number>();
    const duplicated = new Set<number>();
    for (const honorId of honorIds) {
      if (seen.has(honorId)) duplicated.add(honorId);
      seen.add(honorId);
    }

    if (duplicated.size > 0) {
      throw new AppBadRequestException(
        ErrorCode.HONOR_BULK_DUPLICATE_IDS,
        { ids: Array.from(duplicated).join(', ') },
      );
    }

    const activeHonors = await this.prisma.honors.findMany({
      where: {
        honor_id: { in: honorIds },
        active: true,
      },
      select: { honor_id: true },
    });

    const activeHonorIds = new Set(activeHonors.map((item) => item.honor_id));
    const missingHonorIds = honorIds.filter(
      (honorId) => !activeHonorIds.has(honorId),
    );
    if (missingHonorIds.length > 0) {
      throw new AppNotFoundException(
        ErrorCode.HONOR_BULK_NOT_FOUND,
        { ids: missingHonorIds.join(', ') },
      );
    }

    const existingUserHonors = await this.prisma.users_honors.findMany({
      where: {
        user_id: userId,
        honor_id: { in: honorIds },
      },
      select: {
        user_honor_id: true,
        honor_id: true,
      },
    });

    const existingByHonorId = new Map(
      existingUserHonors.map((item) => [item.honor_id, item.user_honor_id]),
    );

    const operations = dto.honors.map((item) => {
      const existingId = existingByHonorId.get(item.honorId);
      if (existingId) {
        return this.prisma.users_honors.update({
          where: { user_honor_id: existingId },
          data: this.buildUpdateDataFromCreateDto(item),
          include: {
            honors: {
              select: {
                honor_id: true,
                name: true,
                honor_image: true,
                honors_categories: { select: { name: true } },
              },
            },
          },
        });
      }

      return this.prisma.users_honors.create({
        data: {
          user_id: userId,
          honor_id: item.honorId,
          ...this.buildCreateDataFromCreateDto(item),
        },
        include: {
          honors: {
            select: {
              honor_id: true,
              name: true,
              honor_image: true,
              honors_categories: { select: { name: true } },
            },
          },
        },
      });
    });

    const createdOrUpdated = await Promise.all(operations);
    return Promise.all(
      createdOrUpdated.map((userHonor) =>
        HONOR_DETAIL_URL_LIMITER(() => this.mapUserHonorPrivateUrls(userHonor)),
      ),
    );
  }

  async uploadUserHonorFiles(
    userId: string,
    honorId: number,
    files: {
      certificate?: Express.Multer.File[];
      document?: Express.Multer.File[];
      images?: Express.Multer.File[];
    },
  ) {
    const certificateFile = files.certificate?.[0];
    const documentFile = files.document?.[0];
    const imageFiles = files.images ?? [];

    if (!certificateFile && !documentFile && imageFiles.length === 0) {
      throw new AppBadRequestException(ErrorCode.HONOR_FILE_REQUIRED);
    }

    // Hard cap: reject requests that exceed the maximum number of images per
    // upload. The controller enforces maxCount: 10 via Multer, but this guard
    // defends against direct service calls (tests, CLI, future callers) that
    // bypass the HTTP layer. Keeps the presign fan-out bounded at 10 URLs max.
    if (imageFiles.length > 10) {
      throw new AppBadRequestException(ErrorCode.HONOR_EVIDENCE_MAX_REACHED);
    }

    await this.findOne(honorId);

    if (certificateFile) {
      this.validateCertificateFile(certificateFile);
    }
    if (documentFile) {
      this.validateDocumentFile(documentFile);
    }
    for (const imageFile of imageFiles) {
      this.validateImageFile(imageFile);
    }

    const existingUserHonor = await this.prisma.users_honors.findFirst({
      where: {
        user_id: userId,
        honor_id: honorId,
      },
      select: {
        user_honor_id: true,
        date: true,
        validate: true,
        certificate: true,
        images: true,
        document: true,
      },
    });

    const currentImages = this.extractImageUrls(existingUserHonor?.images);
    let nextCertificateUrl = existingUserHonor?.certificate || '';
    let nextDocumentUrl =
      typeof existingUserHonor?.document === 'string'
        ? existingUserHonor.document
        : null;
    const previousCertificateUrl = existingUserHonor?.certificate || '';
    const previousDocumentUrl =
      typeof existingUserHonor?.document === 'string'
        ? existingUserHonor.document
        : null;
    const uploadedImageUrls: string[] = [];
    const uploadedObjects: UploadedObjectRef[] = [];

    try {
      if (certificateFile) {
        const certificateExtension = this.getFileExtension(certificateFile);
        const certificateName = `cert-${userId}-${honorId}-${Date.now()}.${certificateExtension}`;
        const uploadedCertificate = await this.fileStorage.upload(
          StorageBucketAlias.USERS_HONORS_CERT,
          certificateName,
          certificateFile.buffer,
          {
            contentType: certificateFile.mimetype,
          },
        );
        uploadedObjects.push({
          bucketAlias: StorageBucketAlias.USERS_HONORS_CERT,
          key: uploadedCertificate.key,
        });
        nextCertificateUrl = uploadedCertificate.url;
      }

      if (documentFile) {
        const documentExtension = this.getFileExtension(documentFile);
        const documentName = `doc-${userId}-${honorId}-${Date.now()}.${documentExtension}`;
        const uploadedDocument = await this.fileStorage.upload(
          StorageBucketAlias.USERS_HONORS,
          documentName,
          documentFile.buffer,
          {
            contentType: documentFile.mimetype,
          },
        );
        uploadedObjects.push({
          bucketAlias: StorageBucketAlias.USERS_HONORS,
          key: uploadedDocument.key,
        });
        nextDocumentUrl = uploadedDocument.url;
      }

      let imageIndex = currentImages.length + 1;
      for (const imageFile of imageFiles) {
        const extension = this.getFileExtension(imageFile);
        const imageName = `img-${userId}-${honorId}-img${imageIndex}.${extension}`;
        const uploadedImage = await this.fileStorage.upload(
          StorageBucketAlias.USERS_HONORS,
          imageName,
          imageFile.buffer,
          {
            contentType: imageFile.mimetype,
            overwrite: false,
          },
        );
        uploadedObjects.push({
          bucketAlias: StorageBucketAlias.USERS_HONORS,
          key: uploadedImage.key,
        });
        uploadedImageUrls.push(uploadedImage.url);
        imageIndex += 1;
      }
    } catch (error) {
      await this.rollbackUploadedObjects(uploadedObjects);
      throw new AppInternalServerErrorException(ErrorCode.HONOR_FILE_UPLOAD_FAILED);
    }

    const finalImages = [...currentImages, ...uploadedImageUrls];

    let updated: any;
    try {
      updated = await this.prisma.$transaction((tx) =>
        tx.users_honors.upsert({
          where: {
            user_id_honor_id: {
              user_id: userId,
              honor_id: honorId,
            },
          },
          update: {
            active: true,
            modified_at: new Date(),
            ...(certificateFile ? { certificate: nextCertificateUrl } : {}),
            ...(documentFile ? { document: nextDocumentUrl } : {}),
            ...(uploadedImageUrls.length > 0
              ? { images: finalImages as Prisma.InputJsonValue }
              : {}),
          },
          create: {
            user_id: userId,
            honor_id: honorId,
            date: existingUserHonor?.date ?? new Date(),
            validate: existingUserHonor?.validate ?? false,
            certificate: certificateFile
              ? nextCertificateUrl
              : previousCertificateUrl,
            images: finalImages as Prisma.InputJsonValue,
            document: documentFile
              ? nextDocumentUrl
              : (existingUserHonor?.document ?? null),
            active: true,
          },
          include: {
            honors: {
              select: {
                honor_id: true,
                name: true,
                honor_image: true,
                honors_categories: { select: { name: true } },
              },
            },
          },
        }),
      );
    } catch (error) {
      await this.rollbackUploadedObjects(uploadedObjects);
      throw new AppInternalServerErrorException(ErrorCode.HONOR_FILE_UPLOAD_FAILED);
    }

    if (
      certificateFile &&
      previousCertificateUrl &&
      previousCertificateUrl !== nextCertificateUrl
    ) {
      await this.cleanupPreviousCertificate(previousCertificateUrl);
    }
    if (
      documentFile &&
      previousDocumentUrl &&
      previousDocumentUrl !== nextDocumentUrl
    ) {
      await this.cleanupPreviousDocument(previousDocumentUrl);
    }

    return {
      status: 'success',
      data: {
        user_honor: await this.mapUserHonorPrivateUrls(updated),
        uploaded: {
          certificate:
            certificateFile && nextCertificateUrl
              ? await this.resolvePrivateAssetUrl(
                  StorageBucketAlias.USERS_HONORS_CERT,
                  nextCertificateUrl,
                )
              : null,
          document:
            documentFile && nextDocumentUrl
              ? await this.resolvePrivateAssetUrl(
                  StorageBucketAlias.USERS_HONORS,
                  nextDocumentUrl,
                )
              : null,
          images: await Promise.all(
            uploadedImageUrls.map((url) =>
              HONOR_DETAIL_URL_LIMITER(() =>
                this.resolvePrivateAssetUrl(StorageBucketAlias.USERS_HONORS, url),
              ),
            ),
          ),
        },
      },
      message: 'Archivos del honor subidos exitosamente',
    };
  }

  async updateUserHonor(
    userId: string,
    honorId: number,
    dto: UpdateUserHonorDto,
  ) {
    const userHonor = await this.prisma.users_honors.findFirst({
      where: {
        user_id: userId,
        honor_id: honorId,
        active: true,
      },
    });

    if (!userHonor) {
      throw new AppNotFoundException(ErrorCode.HONOR_USER_HONOR_NOT_FOUND);
    }

    const updateData: any = {
      modified_at: new Date(),
    };

    // Permitir actualizar validación
    if (dto.validate !== undefined) updateData.validate = dto.validate;

    // Permitir limpiar certificado (null o string vacío)
    if (dto.certificate !== undefined) {
      updateData.certificate = dto.certificate || '';
    }

    // Permitir limpiar imágenes (null o array vacío)
    if (dto.images !== undefined) {
      updateData.images = (dto.images || []) as Prisma.InputJsonValue;
    }

    // Permitir limpiar documento (null)
    if (dto.document !== undefined) {
      updateData.document = dto.document || null;
    }

    // Actualizar fecha
    if (dto.date) updateData.date = new Date(dto.date);

    const updated = await this.prisma.users_honors.update({
      where: { user_honor_id: userHonor.user_honor_id },
      data: updateData,
      include: {
        honors: { select: { name: true, honor_image: true } },
      },
    });

    return this.mapUserHonorPrivateUrls(updated);
  }

  async abandonHonor(userId: string, honorId: number) {
    const userHonor = await this.prisma.users_honors.findFirst({
      where: {
        user_id: userId,
        honor_id: honorId,
        active: true,
      },
    });

    if (!userHonor) {
      throw new AppNotFoundException(ErrorCode.HONOR_USER_HONOR_NOT_FOUND);
    }

    return this.prisma.users_honors.update({
      where: { user_honor_id: userHonor.user_honor_id },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });
  }

  // ========================================
  // ESTADÍSTICAS
  // ========================================

  async getUserHonorStats(userId: string) {
    const where = { user_id: userId, active: true };

    const [total, approved, pendingReview, rejected, inProgress] =
      await Promise.all([
        this.prisma.users_honors.count({ where }),
        this.prisma.users_honors.count({
          where: { ...where, validation_status: 'APPROVED' },
        }),
        this.prisma.users_honors.count({
          where: { ...where, validation_status: 'PENDING_REVIEW' },
        }),
        this.prisma.users_honors.count({
          where: { ...where, validation_status: 'REJECTED' },
        }),
        this.prisma.users_honors.count({
          where: { ...where, validation_status: 'IN_PROGRESS' },
        }),
      ]);

    return {
      total,
      validated: approved, // backward compat
      in_progress: inProgress,
      pending_review: pendingReview,
      rejected,
      approved,
    };
  }

  private buildCreateDataFromCreateDto(dto: CreateUserHonorDto) {
    return {
      active: true,
      date: dto.date ? new Date(dto.date) : new Date(),
      validate: dto.validate ?? false,
      certificate: dto.certificate || '',
      images: (dto.images || []) as Prisma.InputJsonValue,
      document: dto.document || null,
    };
  }

  private buildUpdateDataFromCreateDto(dto: CreateUserHonorDto) {
    const data: Prisma.users_honorsUncheckedUpdateInput = {
      active: true,
      modified_at: new Date(),
    };

    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.validate !== undefined) data.validate = dto.validate;
    if (dto.certificate !== undefined) data.certificate = dto.certificate || '';
    if (dto.images !== undefined)
      data.images = (dto.images || []) as Prisma.InputJsonValue;
    if (dto.document !== undefined) data.document = dto.document || null;

    return data;
  }

  private extractImageUrls(
    images: Prisma.JsonValue | null | undefined,
  ): string[] {
    if (!Array.isArray(images)) return [];
    return images.filter((value): value is string => typeof value === 'string');
  }

  private getFileExtension(file: Express.Multer.File): string {
    const mimeToExtension: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };

    if (mimeToExtension[file.mimetype]) {
      return mimeToExtension[file.mimetype];
    }

    const originalExtension = file.originalname.split('.').pop()?.toLowerCase();
    if (originalExtension) return originalExtension;
    return 'bin';
  }

  private validateCertificateFile(file: Express.Multer.File) {
    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new AppBadRequestException(
        ErrorCode.HONOR_FILE_INVALID_FORMAT,
        { allowed: 'PDF, JPG, PNG, WEBP' },
      );
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new AppBadRequestException(
        ErrorCode.HONOR_FILE_TOO_LARGE,
        { max_mb: '10' },
      );
    }
  }

  private validateImageFile(file: Express.Multer.File) {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new AppBadRequestException(
        ErrorCode.HONOR_FILE_INVALID_FORMAT,
        { allowed: 'JPG, PNG, WEBP' },
      );
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new AppBadRequestException(
        ErrorCode.HONOR_FILE_TOO_LARGE,
        { max_mb: '10' },
      );
    }
  }

  private validateDocumentFile(file: Express.Multer.File) {
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new AppBadRequestException(
        ErrorCode.HONOR_FILE_INVALID_FORMAT,
        { allowed: 'PDF, DOC, DOCX, JPG, PNG, WEBP' },
      );
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new AppBadRequestException(
        ErrorCode.HONOR_FILE_TOO_LARGE,
        { max_mb: '10' },
      );
    }
  }

  private async rollbackUploadedObjects(uploadedObjects: UploadedObjectRef[]) {
    if (uploadedObjects.length === 0) return;

    const keysByBucket = uploadedObjects.reduce<
      Map<StorageBucketAlias, string[]>
    >((acc, uploadedObject) => {
      const existing = acc.get(uploadedObject.bucketAlias) ?? [];
      existing.push(uploadedObject.key);
      acc.set(uploadedObject.bucketAlias, existing);
      return acc;
    }, new Map<StorageBucketAlias, string[]>());

    for (const [bucketAlias, keys] of keysByBucket.entries()) {
      try {
        await this.fileStorage.deleteMany(bucketAlias, keys);
      } catch (error) {
        this.logger.error(
          `Critical: failed to rollback uploaded honors objects in ${bucketAlias}. Manual remediation required.`,
          error,
        );
      }
    }
  }

  private async cleanupPreviousCertificate(previousCertificateUrl: string) {
    const previousKey = this.fileStorage.extractKeyFromPublicUrl(
      StorageBucketAlias.USERS_HONORS_CERT,
      previousCertificateUrl,
    );

    if (!previousKey) return;

    try {
      await this.fileStorage.deleteMany(StorageBucketAlias.USERS_HONORS_CERT, [
        previousKey,
      ]);
    } catch (error) {
      this.logger.warn(
        `Best-effort cleanup failed for previous certificate: ${previousKey}`,
        error,
      );
    }
  }

  private async cleanupPreviousDocument(previousDocumentUrl: string) {
    const previousKey = this.fileStorage.extractKeyFromPublicUrl(
      StorageBucketAlias.USERS_HONORS,
      previousDocumentUrl,
    );

    if (!previousKey) return;

    try {
      await this.fileStorage.deleteMany(StorageBucketAlias.USERS_HONORS, [
        previousKey,
      ]);
    } catch (error) {
      this.logger.warn(
        `Best-effort cleanup failed for previous document: ${previousKey}`,
        error,
      );
    }
  }

  private async mapUserHonorPrivateUrls<T extends Record<string, any>>(
    userHonor: T,
  ): Promise<T> {
    if (!userHonor) return userHonor;

    const hasCertificate = Object.prototype.hasOwnProperty.call(
      userHonor,
      'certificate',
    );
    const hasDocument = Object.prototype.hasOwnProperty.call(
      userHonor,
      'document',
    );
    const hasImages = Object.prototype.hasOwnProperty.call(userHonor, 'images');

    const [certificate, document] = await Promise.all([
      hasCertificate
        ? this.resolvePrivateAssetUrl(
            StorageBucketAlias.USERS_HONORS_CERT,
            typeof userHonor.certificate === 'string'
              ? userHonor.certificate
              : null,
          )
        : Promise.resolve(null),
      hasDocument
        ? this.resolvePrivateAssetUrl(
            StorageBucketAlias.USERS_HONORS,
            typeof userHonor.document === 'string' ? userHonor.document : null,
          )
        : Promise.resolve(null),
    ]);

    let images: unknown = userHonor.images;
    if (hasImages && Array.isArray(userHonor.images)) {
      const urls = userHonor.images.filter(
        (value: unknown): value is string => typeof value === 'string',
      );
      images = await Promise.all(
        urls.map((url) =>
          HONOR_DETAIL_URL_LIMITER(() =>
            this.resolvePrivateAssetUrl(StorageBucketAlias.USERS_HONORS, url),
          ),
        ),
      );
    }

    const mapped: Record<string, unknown> = { ...userHonor };
    if (hasCertificate) mapped.certificate = certificate ?? '';
    if (hasDocument) mapped.document = document ?? null;
    if (hasImages) mapped.images = images;

    return mapped as T;
  }

  private async resolvePrivateAssetUrl(
    bucketAlias: StorageBucketAlias,
    value: string | null | undefined,
  ): Promise<string | null> {
    if (!value) return null;

    try {
      return await this.fileStorage.getSignedDownloadUrl(bucketAlias, value, {
        expiresInSeconds: HonorsService.PRIVATE_ASSET_URL_TTL_SECONDS,
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
