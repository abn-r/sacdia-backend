import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { randomUUID } from 'crypto';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALLOWED_RESOURCE_MIME_TYPES,
  validateResourceFile,
} from './pipes/resource-file-validation.pipe';
import type { CreateResourceDto } from './dto/create-resource.dto';
import type { UpdateResourceDto } from './dto/update-resource.dto';
import type { ResourceQueryDto } from './dto/resource-query.dto';
import { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import type { CreateResourceFromUploadedDto } from './dto/create-resource-from-uploaded.dto';

/** TTL de URLs firmadas de descarga: 1 hora */
const SIGNED_URL_TTL_SECONDS = 3600;

/** TTL de URLs firmadas de subida: 15 minutos (suficiente para uploads grandes) */
const SIGNED_UPLOAD_TTL_SECONDS = 15 * 60;

/** Tolerancia entre tamaño anunciado y real en R2 antes de rechazar (1%). */
const FILE_SIZE_TOLERANCE_RATIO = 0.01;

@Injectable()
export class ResourcesService {
  private readonly logger = new Logger(ResourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------

  async create(
    dto: CreateResourceDto,
    file: Express.Multer.File | undefined,
    uploadedBy: string,
    userContext: any,
  ) {
    // 1. Validar tipo de archivo contra resource_type
    validateResourceFile(file, dto.resource_type);

    // 2. Validar autorización de scope
    this.validateScopeAuthorization(dto.scope_level, dto.scope_id, userContext);

    // 3. Validar coherencia scope_level / scope_id
    if (dto.scope_level === 'system' && dto.scope_id != null) {
      throw new AppBadRequestException(
        ErrorCode.RESOURCE_SCOPE_SYSTEM_NO_SCOPE_ID,
      );
    }
    if (dto.scope_level !== 'system' && dto.scope_id == null) {
      throw new AppBadRequestException(
        ErrorCode.RESOURCE_SCOPE_NON_SYSTEM_MISSING_SCOPE_ID,
        { scope_level: dto.scope_level },
      );
    }

    // 4. Validar resource_category_id si se provee
    if (dto.resource_category_id != null) {
      const category = await this.prisma.resource_categories.findUnique({
        where: { resource_category_id: dto.resource_category_id },
        select: { resource_category_id: true, active: true },
      });
      if (!category || !category.active) {
        throw new AppNotFoundException(ErrorCode.RESOURCE_CATEGORY_NOT_FOUND);
      }
    }

    // 5. Validar club_type_id si se provee
    if (dto.club_type_id != null) {
      const clubType = await (this.prisma as any).club_types.findUnique({
        where: { club_type_id: dto.club_type_id },
        select: { club_type_id: true },
      });
      if (!clubType) {
        throw new AppNotFoundException(ErrorCode.RESOURCE_CLUB_TYPE_NOT_FOUND);
      }
    }

    // 6. Subir archivo si existe
    let fileKey: string | null = null;
    let fileName: string | null = null;
    let fileSize: number | null = null;
    let fileMimeType: string | null = null;

    if (file?.buffer) {
      const scopeSegment =
        dto.scope_id != null ? String(dto.scope_id) : 'system';
      const uuid = randomUUID();

      // Extract and sanitize the file extension from the original filename.
      // We deliberately discard the rest of the name (attacker-controlled) and
      // use the UUID as the authoritative filename to prevent path traversal via
      // `../`, special Unicode, or excessively long names.
      const rawExt = file.originalname.includes('.')
        ? file.originalname.slice(file.originalname.lastIndexOf('.'))
        : '';
      // Keep only [a-zA-Z0-9.] — strip anything else (e.g. null bytes, slashes)
      const safeExtension = rawExt.replace(/[^a-zA-Z0-9.]/g, '');

      fileKey = `${dto.scope_level}/${scopeSegment}/${uuid}${safeExtension}`;

      const uploaded = await this.fileStorage.upload(
        StorageBucketAlias.RESOURCES_FILES,
        fileKey,
        file.buffer,
        { contentType: file.mimetype },
      );

      fileName = file.originalname;
      fileSize = file.size;
      fileMimeType = file.mimetype;

      this.logger.log(
        `Archivo subido a R2: ${uploaded.key} (${fileSize} bytes)`,
      );
    }

    // 7. Crear registro en DB
    const resource = await this.prisma.resources.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        resource_type: dto.resource_type,
        resource_category_id: dto.resource_category_id ?? null,
        club_type_id: dto.club_type_id ?? null,
        scope_level: dto.scope_level,
        scope_id: dto.scope_id ?? null,
        file_key: fileKey,
        file_name: fileName,
        file_size: fileSize,
        file_mime_type: fileMimeType,
        content: dto.content ?? null,
        external_url: dto.external_url ?? null,
        uploaded_by: uploadedBy,
        active: true,
      },
      include: {
        resource_categories: true,
        club_types: true,
        users: {
          select: { name: true, user_id: true },
        },
      },
    });

    return resource;
  }

  // ---------------------------------------------------------------------------
  // GENERATE UPLOAD URL (presigned PUT for direct-to-R2 client uploads)
  // ---------------------------------------------------------------------------

  async generateUploadUrl(dto: GenerateUploadUrlDto, userContext: any) {
    // 1. Authorize scope before issuing the URL — otherwise an attacker could
    // burn presigned URLs for scopes they cannot create resources in.
    this.validateScopeAuthorization(dto.scope_level, dto.scope_id, userContext);

    if (dto.scope_level === 'system' && dto.scope_id != null) {
      throw new AppBadRequestException(
        ErrorCode.RESOURCE_SCOPE_SYSTEM_NO_SCOPE_ID,
      );
    }
    if (dto.scope_level !== 'system' && dto.scope_id == null) {
      throw new AppBadRequestException(
        ErrorCode.RESOURCE_SCOPE_NON_SYSTEM_MISSING_SCOPE_ID,
        { scope_level: dto.scope_level },
      );
    }

    // 2. MIME must match what the resource_type accepts. This is the only line
    // of defense we have before the upload happens, so do it strictly.
    const allowed = ALLOWED_RESOURCE_MIME_TYPES[dto.resource_type];
    if (!allowed || !allowed.includes(dto.mime_type)) {
      throw new AppBadRequestException(ErrorCode.RESOURCE_FILE_TYPE_INVALID, {
        resource_type: dto.resource_type,
        allowed: (allowed ?? []).join(', '),
      });
    }

    // 3. Build a deterministic key under the scope folder. Mirrors the layout
    // used by create() so admin tooling does not have to deal with two schemes.
    const scopeSegment = dto.scope_id != null ? String(dto.scope_id) : 'system';
    const uuid = randomUUID();
    const rawExt = dto.file_name.includes('.')
      ? dto.file_name.slice(dto.file_name.lastIndexOf('.'))
      : '';
    const safeExtension = rawExt.replace(/[^a-zA-Z0-9.]/g, '');
    const relativeKey = `${dto.scope_level}/${scopeSegment}/${uuid}${safeExtension}`;

    const signed = await this.fileStorage.getSignedUploadUrl(
      StorageBucketAlias.RESOURCES_FILES,
      relativeKey,
      {
        contentType: dto.mime_type,
        contentLength: dto.file_size,
        expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
      },
    );

    return {
      upload_url: signed.url,
      file_key: signed.key,
      expires_in: signed.expiresInSeconds,
      required_headers: {
        'Content-Type': dto.mime_type,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // CREATE FROM UPLOADED KEY (companion to generateUploadUrl)
  // ---------------------------------------------------------------------------

  async createFromUploaded(
    dto: CreateResourceFromUploadedDto,
    uploadedBy: string,
    userContext: any,
  ) {
    // 1. Same scope/auth gating as direct create().
    this.validateScopeAuthorization(dto.scope_level, dto.scope_id, userContext);

    if (dto.scope_level === 'system' && dto.scope_id != null) {
      throw new AppBadRequestException(
        ErrorCode.RESOURCE_SCOPE_SYSTEM_NO_SCOPE_ID,
      );
    }
    if (dto.scope_level !== 'system' && dto.scope_id == null) {
      throw new AppBadRequestException(
        ErrorCode.RESOURCE_SCOPE_NON_SYSTEM_MISSING_SCOPE_ID,
        { scope_level: dto.scope_level },
      );
    }

    // 2. The file_key must live under the same scope path we would have issued
    // in generateUploadUrl. Prevents replaying a key from a different scope.
    const scopeSegment = dto.scope_id != null ? String(dto.scope_id) : 'system';
    const expectedPrefix = `${dto.scope_level}/${scopeSegment}/`;
    const keyWithoutBucketPrefix = dto.file_key.includes('resources/')
      ? dto.file_key.slice(
          dto.file_key.indexOf('resources/') + 'resources/'.length,
        )
      : dto.file_key;
    if (!keyWithoutBucketPrefix.startsWith(expectedPrefix)) {
      throw new AppForbiddenException(ErrorCode.RESOURCE_SCOPE_LEVEL_INVALID, {
        scope_level: dto.scope_level,
      });
    }

    // 3. MIME must match resource_type.
    const allowed = ALLOWED_RESOURCE_MIME_TYPES[dto.resource_type];
    if (!allowed || !allowed.includes(dto.file_mime_type)) {
      throw new AppBadRequestException(ErrorCode.RESOURCE_FILE_TYPE_INVALID, {
        resource_type: dto.resource_type,
        allowed: (allowed ?? []).join(', '),
      });
    }

    // 4. Confirm the object actually exists in R2 — otherwise the client never
    // completed the PUT and we would orphan a DB row.
    const stored = await this.fileStorage.getObjectInfo(
      StorageBucketAlias.RESOURCES_FILES,
      dto.file_key,
    );
    if (!stored) {
      throw new AppBadRequestException(ErrorCode.RESOURCE_FILE_REQUIRED, {
        resource_type: dto.resource_type,
      });
    }

    // Size sanity check — guard against the client lying about file_size to
    // bypass the DTO @Max validation.
    const declared = dto.file_size;
    const actual = stored.size;
    const tolerance = Math.max(1024, declared * FILE_SIZE_TOLERANCE_RATIO);
    if (Math.abs(actual - declared) > tolerance) {
      throw new AppBadRequestException(ErrorCode.RESOURCE_FILE_TOO_LARGE, {
        max_mb: String(Math.ceil(actual / (1024 * 1024))),
      });
    }

    // 5. Validate related FKs (mirror create()).
    if (dto.resource_category_id != null) {
      const category = await this.prisma.resource_categories.findUnique({
        where: { resource_category_id: dto.resource_category_id },
        select: { resource_category_id: true, active: true },
      });
      if (!category || !category.active) {
        throw new AppNotFoundException(ErrorCode.RESOURCE_CATEGORY_NOT_FOUND);
      }
    }

    if (dto.club_type_id != null) {
      const clubType = await (this.prisma as any).club_types.findUnique({
        where: { club_type_id: dto.club_type_id },
        select: { club_type_id: true },
      });
      if (!clubType) {
        throw new AppNotFoundException(ErrorCode.RESOURCE_CLUB_TYPE_NOT_FOUND);
      }
    }

    // 6. Persist.
    const resource = await this.prisma.resources.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        resource_type: dto.resource_type,
        resource_category_id: dto.resource_category_id ?? null,
        club_type_id: dto.club_type_id ?? null,
        scope_level: dto.scope_level,
        scope_id: dto.scope_id ?? null,
        file_key: dto.file_key,
        file_name: dto.file_name,
        file_size: actual,
        file_mime_type: dto.file_mime_type,
        uploaded_by: uploadedBy,
        active: true,
      },
      include: {
        resource_categories: true,
        club_types: true,
        users: { select: { name: true, user_id: true } },
      },
    });

    return resource;
  }

  // ---------------------------------------------------------------------------
  // FIND ALL (admin — without scope filtering)
  // ---------------------------------------------------------------------------

  async findAll(query: ResourceQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {
      active: true,
      ...(query.resource_type && { resource_type: query.resource_type }),
      ...(query.resource_category_id && {
        resource_category_id: query.resource_category_id,
      }),
      ...(query.club_type_id && { club_type_id: query.club_type_id }),
      ...(query.scope_level && { scope_level: query.scope_level }),
      ...(query.scope_id != null && { scope_id: query.scope_id }),
      ...(query.search && {
        title: { contains: query.search, mode: 'insensitive' },
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.resources.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          resource_categories: true,
          club_types: true,
          users: {
            select: { name: true, user_id: true },
          },
        },
      }),
      this.prisma.resources.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ---------------------------------------------------------------------------
  // FIND ONE
  // ---------------------------------------------------------------------------

  async findOne(id: string) {
    const resource = await this.prisma.resources.findUnique({
      where: { resource_id: id },
      include: {
        resource_categories: true,
        club_types: true,
        users: {
          select: { name: true, user_id: true },
        },
      },
    });

    if (!resource) {
      throw new AppNotFoundException(ErrorCode.RESOURCE_NOT_FOUND);
    }

    let signedUrl: string | null = null;
    if (resource.file_key) {
      signedUrl = await this.resolveSignedUrl(resource.file_key);
    }

    return { ...resource, signed_url: signedUrl };
  }

  // ---------------------------------------------------------------------------
  // GET VISIBLE RESOURCES (app-facing — scope filtered)
  // ---------------------------------------------------------------------------

  async getVisibleResources(query: ResourceQueryDto, userContext: any) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const globalScope = userContext?.authorization?.effective?.scope?.global;
    const userUnionId: number | null = globalScope?.union?.id ?? null;
    const userLocalFieldId: number | null =
      globalScope?.local_field?.id ?? null;

    // club_type_id del usuario se obtiene de su asignación de club activa
    const userClubTypeId: number | null =
      userContext?.authorization?.effective?.club_type_id ?? null;

    const where: Record<string, any> = {
      active: true,
      AND: [
        // Visibilidad por scope
        {
          OR: [
            { scope_level: 'system' },
            ...(userUnionId != null
              ? [{ scope_level: 'union', scope_id: userUnionId }]
              : []),
            ...(userLocalFieldId != null
              ? [{ scope_level: 'local_field', scope_id: userLocalFieldId }]
              : []),
          ],
        },
        // Visibilidad por tipo de club
        {
          OR: [
            { club_type_id: null },
            ...(userClubTypeId != null
              ? [{ club_type_id: userClubTypeId }]
              : []),
          ],
        },
      ],
      // Filtros adicionales del query
      ...(query.resource_type && { resource_type: query.resource_type }),
      ...(query.resource_category_id && {
        resource_category_id: query.resource_category_id,
      }),
      ...(query.search && {
        title: { contains: query.search, mode: 'insensitive' },
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.resources.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          resource_categories: true,
          club_types: true,
        },
      }),
      this.prisma.resources.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------

  async update(id: string, dto: UpdateResourceDto) {
    const existing = await this.prisma.resources.findUnique({
      where: { resource_id: id },
      select: { resource_id: true },
    });

    if (!existing) {
      throw new AppNotFoundException(ErrorCode.RESOURCE_NOT_FOUND);
    }

    const updateData: Record<string, any> = {};

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined)
      updateData.description = dto.description ?? null;
    if (dto.resource_category_id !== undefined)
      updateData.resource_category_id = dto.resource_category_id ?? null;
    if (dto.club_type_id !== undefined)
      updateData.club_type_id = dto.club_type_id ?? null;
    if (dto.scope_level !== undefined) updateData.scope_level = dto.scope_level;
    if (dto.scope_id !== undefined) updateData.scope_id = dto.scope_id ?? null;
    if (dto.external_url !== undefined)
      updateData.external_url = dto.external_url ?? null;
    if (dto.content !== undefined) updateData.content = dto.content ?? null;
    if (dto.active !== undefined) updateData.active = dto.active;

    return this.prisma.resources.update({
      where: { resource_id: id },
      data: updateData,
      include: {
        resource_categories: true,
        club_types: true,
        users: {
          select: { name: true, user_id: true },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // REMOVE (soft delete)
  // ---------------------------------------------------------------------------

  async remove(id: string) {
    const existing = await this.prisma.resources.findUnique({
      where: { resource_id: id },
      select: { resource_id: true },
    });

    if (!existing) {
      throw new AppNotFoundException(ErrorCode.RESOURCE_NOT_FOUND);
    }

    await this.prisma.resources.update({
      where: { resource_id: id },
      data: { active: false },
    });

    return { message: 'Recurso eliminado correctamente' };
  }

  // ---------------------------------------------------------------------------
  // GET SIGNED URL
  // ---------------------------------------------------------------------------

  async getSignedUrl(id: string) {
    const resource = await this.prisma.resources.findUnique({
      where: { resource_id: id },
      select: { resource_id: true, file_key: true, active: true },
    });

    if (!resource) {
      throw new AppNotFoundException(ErrorCode.RESOURCE_NOT_FOUND);
    }

    if (!resource.file_key) {
      throw new AppBadRequestException(ErrorCode.RESOURCE_NO_FILE);
    }

    const url = await this.resolveSignedUrl(resource.file_key);

    return { url, expires_in: SIGNED_URL_TTL_SECONDS };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Valida que el usuario que crea/modifica el recurso tenga permiso
   * sobre el scope_level/scope_id indicado.
   */
  private validateScopeAuthorization(
    scopeLevel: string,
    scopeId: number | null | undefined,
    userContext: any,
  ): void {
    const globalScope = userContext?.authorization?.effective?.scope?.global;
    const userCountryId = globalScope?.country?.id ?? null;
    const userUnionId = globalScope?.union?.id ?? null;
    const userLfId = globalScope?.local_field?.id ?? null;

    if (scopeLevel === 'system') {
      if (!userCountryId) {
        throw new AppForbiddenException(
          ErrorCode.RESOURCE_SCOPE_ACCESS_DENIED_SYSTEM,
        );
      }
      return;
    }

    if (scopeLevel === 'union') {
      if (userCountryId) return;
      if (userUnionId && userUnionId === scopeId) return;
      throw new AppForbiddenException(
        ErrorCode.RESOURCE_SCOPE_ACCESS_DENIED_UNION,
        { scope_id: String(scopeId) },
      );
    }

    if (scopeLevel === 'local_field') {
      if (userCountryId) return;
      if (userLfId && userLfId === scopeId) return;
      throw new AppForbiddenException(
        ErrorCode.RESOURCE_SCOPE_ACCESS_DENIED_LOCAL_FIELD,
        { scope_id: String(scopeId) },
      );
    }

    throw new AppBadRequestException(ErrorCode.RESOURCE_SCOPE_LEVEL_INVALID, {
      scope_level: scopeLevel,
    });
  }

  /** Genera una URL firmada para un file_key en R2. */
  private async resolveSignedUrl(fileKey: string): Promise<string | null> {
    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.RESOURCES_FILES,
        fileKey,
        { expiresInSeconds: SIGNED_URL_TTL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(`No se pudo generar URL firmada para ${fileKey}`, error);
      return null;
    }
  }
}
