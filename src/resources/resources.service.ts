import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { validateResourceFile } from './pipes/resource-file-validation.pipe';
import type { CreateResourceDto } from './dto/create-resource.dto';
import type { UpdateResourceDto } from './dto/update-resource.dto';
import type { ResourceQueryDto } from './dto/resource-query.dto';

/** TTL de URLs firmadas: 1 hora */
const SIGNED_URL_TTL_SECONDS = 3600;

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
      throw new BadRequestException(
        'Los recursos de alcance sistema no deben tener scope_id',
      );
    }
    if (dto.scope_level !== 'system' && dto.scope_id == null) {
      throw new BadRequestException(
        'Los recursos de alcance union o campo local requieren scope_id',
      );
    }

    // 4. Validar resource_category_id si se provee
    if (dto.resource_category_id != null) {
      const category = await this.prisma.resource_categories.findUnique({
        where: { resource_category_id: dto.resource_category_id },
        select: { resource_category_id: true, active: true },
      });
      if (!category || !category.active) {
        throw new BadRequestException('Categoría de recurso no encontrada');
      }
    }

    // 5. Validar club_type_id si se provee
    if (dto.club_type_id != null) {
      const clubType = await (this.prisma as any).club_types.findUnique({
        where: { club_type_id: dto.club_type_id },
        select: { club_type_id: true },
      });
      if (!clubType) {
        throw new BadRequestException('Tipo de club no encontrado');
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
      fileKey = `${dto.scope_level}/${scopeSegment}/${uuid}/${file.originalname}`;

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
      throw new NotFoundException('Recurso no encontrado');
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
      throw new NotFoundException('Recurso no encontrado');
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
      throw new NotFoundException('Recurso no encontrado');
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
      throw new NotFoundException('Recurso no encontrado');
    }

    if (!resource.file_key) {
      throw new BadRequestException(
        'Este recurso no tiene un archivo asociado',
      );
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

    if (scopeLevel === 'system') {
      if (!globalScope?.country?.id) {
        throw new ForbiddenException(
          'Solo administradores de nivel sistema pueden crear recursos de alcance sistema',
        );
      }
      return;
    }

    if (scopeLevel === 'union') {
      const userUnionId = globalScope?.union?.id;
      const userCountryId = globalScope?.country?.id;
      // Administrador de país puede gestionar cualquier unión
      if (userCountryId) return;
      if (userUnionId !== scopeId) {
        throw new ForbiddenException(
          'No tiene permiso para crear recursos en esta unión',
        );
      }
      return;
    }

    if (scopeLevel === 'local_field') {
      const userLfId = globalScope?.local_field?.id;
      const userUnionId = globalScope?.union?.id;
      const userCountryId = globalScope?.country?.id;
      // Administrador de país
      if (userCountryId) return;
      // Administrador de unión puede gestionar cualquier campo de su unión
      // (el guard de scope ya restringe qué campos son visibles)
      if (userUnionId) return;
      if (userLfId !== scopeId) {
        throw new ForbiddenException(
          'No tiene permiso para crear recursos en este campo local',
        );
      }
      return;
    }

    throw new BadRequestException('Nivel de alcance inválido');
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
