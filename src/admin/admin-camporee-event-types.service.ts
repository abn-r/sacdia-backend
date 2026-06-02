import { Injectable, Logger } from '@nestjs/common';
import {
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from '../catalogs/catalog-cache.service';
import { TranslationService } from '../common/services/translation.service';
import { CreateCamporeeEventTypeDto, UpdateCamporeeEventTypeDto } from './dto';

@Injectable()
export class AdminCamporeeEventTypesService {
  private readonly logger = new Logger(AdminCamporeeEventTypesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogCache: CatalogCacheService,
    private readonly translationService: TranslationService,
  ) {}

  private normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private logMutation(
    action: string,
    resourceId: string | number,
    actorId: string,
  ) {
    this.logger.log(
      JSON.stringify({
        action,
        resource: 'camporee_event_types',
        resourceId,
        actorId,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  async listCamporeeEventTypes() {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.CAMPOREE_EVENT_TYPES,
      () =>
        this.prisma.camporee_event_types.findMany({
          orderBy: [{ display_order: 'asc' }, { event_type_id: 'asc' }],
          take: 200,
          include: { translations: true },
        }),
    );
  }

  async createCamporeeEventType(
    dto: CreateCamporeeEventTypeDto,
    actorId: string,
  ) {
    const name = this.normalizeName(dto.name);
    const code = dto.code.trim().toLowerCase();

    this.translationService.validateTranslations(dto.translations);
    await this.ensureUnique(name, code);

    const eventType = await this.prisma.$transaction(async (tx) => {
      const created = await tx.camporee_event_types.create({
        data: {
          code,
          name,
          description: dto.description,
          display_order: dto.display_order ?? null,
          active: dto.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'camporee_event_types_translations',
        'event_type_id',
        'camporee_event_types_translations_unique_locale',
        created.event_type_id,
        dto.translations,
        ['name', 'description'],
      );

      return created;
    });

    this.logMutation('create', eventType.event_type_id, actorId);
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.CAMPOREE_EVENT_TYPES);

    return eventType;
  }

  async updateCamporeeEventType(
    eventTypeId: number,
    dto: UpdateCamporeeEventTypeDto,
    actorId: string,
  ) {
    await this.ensureExists(eventTypeId);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    const code = dto.code ? dto.code.trim().toLowerCase() : undefined;

    if (name || code) {
      await this.ensureUnique(name, code, eventTypeId);
    }

    this.translationService.validateTranslations(dto.translations);

    const eventType = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.camporee_event_types.update({
        where: { event_type_id: eventTypeId },
        data: {
          ...(code ? { code } : {}),
          ...(name ? { name } : {}),
          ...(typeof dto.description === 'string'
            ? { description: dto.description }
            : {}),
          ...(typeof dto.display_order === 'number'
            ? { display_order: dto.display_order }
            : {}),
          ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'camporee_event_types_translations',
        'event_type_id',
        'camporee_event_types_translations_unique_locale',
        eventTypeId,
        dto.translations,
        ['name', 'description'],
      );

      return updated;
    });

    this.logMutation('update', eventTypeId, actorId);
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.CAMPOREE_EVENT_TYPES);

    return eventType;
  }

  async deleteCamporeeEventType(eventTypeId: number, actorId: string) {
    await this.ensureExists(eventTypeId);

    const inUseCount = await this.prisma.camporee_events.count({
      where: { event_type_id: eventTypeId, active: true },
    });

    if (inUseCount > 0) {
      throw new AppConflictException(
        ErrorCode.ADMIN_CAMPOREE_EVENT_TYPE_NOT_FOUND,
        { id: eventTypeId },
      );
    }

    const eventType = await this.prisma.camporee_event_types.update({
      where: { event_type_id: eventTypeId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });

    this.logMutation('delete', eventTypeId, actorId);
    await this.catalogCache.invalidate(CATALOG_CACHE_KEYS.CAMPOREE_EVENT_TYPES);

    return eventType;
  }

  private async ensureExists(eventTypeId: number) {
    const entity = await this.prisma.camporee_event_types.findUnique({
      where: { event_type_id: eventTypeId },
    });

    if (!entity) {
      throw new AppNotFoundException(
        ErrorCode.ADMIN_CAMPOREE_EVENT_TYPE_NOT_FOUND,
        { id: eventTypeId },
      );
    }

    return entity;
  }

  private async ensureUnique(name?: string, code?: string, excludeId?: number) {
    if (name) {
      const existingByName = await this.prisma.camporee_event_types.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          ...(excludeId ? { NOT: { event_type_id: excludeId } } : {}),
        },
      });

      if (existingByName) {
        throw new AppConflictException(
          ErrorCode.ADMIN_CAMPOREE_EVENT_TYPE_NAME_CONFLICT,
        );
      }
    }

    if (code) {
      const existingByCode = await this.prisma.camporee_event_types.findFirst({
        where: {
          code: { equals: code, mode: 'insensitive' },
          ...(excludeId ? { NOT: { event_type_id: excludeId } } : {}),
        },
      });

      if (existingByCode) {
        throw new AppConflictException(
          ErrorCode.ADMIN_CAMPOREE_EVENT_TYPE_CODE_CONFLICT,
        );
      }
    }
  }
}
