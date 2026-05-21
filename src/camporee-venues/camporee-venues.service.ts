import { Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCamporeeVenueDto,
  ListCamporeeVenuesFilterDto,
  UpdateCamporeeVenueDto,
} from './dto';

type CamporeeScope = 'local' | 'union';

@Injectable()
export class CamporeeVenuesService {
  private readonly logger = new Logger(CamporeeVenuesService.name);

  constructor(private readonly prisma: PrismaService) {}

  private logMutation(action: string, resourceId: number, actorId: string) {
    this.logger.log(
      JSON.stringify({
        action,
        resource: 'camporee_venues',
        resourceId,
        actorId,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  private validateScopeXOR(dto: {
    scope: string;
    union_id?: number;
    local_field_id?: number;
  }) {
    if (dto.scope === 'union') {
      if (!dto.union_id) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_VENUE_SCOPE_INVALID,
          { detail: 'union_id is required when scope is union' },
        );
      }
      if (dto.local_field_id) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_VENUE_SCOPE_INVALID,
          { detail: 'local_field_id must be null when scope is union' },
        );
      }
    } else if (dto.scope === 'local_field') {
      if (!dto.local_field_id) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_VENUE_SCOPE_INVALID,
          { detail: 'local_field_id is required when scope is local_field' },
        );
      }
      if (dto.union_id) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_VENUE_SCOPE_INVALID,
          { detail: 'union_id must be null when scope is local_field' },
        );
      }
    } else {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_VENUE_SCOPE_INVALID, {
        detail: 'scope must be union or local_field',
      });
    }
  }

  private async ensureVenueExists(venueId: number) {
    const venue = await this.prisma.camporee_venues.findUnique({
      where: { camporee_venue_id: venueId },
    });
    if (!venue) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_VENUE_NOT_FOUND, {
        id: venueId,
      });
    }
    return venue;
  }

  // ─── List all venues with filters ────────────────────────────────────────

  async listVenues(filters: ListCamporeeVenuesFilterDto) {
    const where: any = {
      ...(filters.scope !== undefined ? { scope: filters.scope } : {}),
      ...(filters.union_id !== undefined ? { union_id: filters.union_id } : {}),
      ...(filters.local_field_id !== undefined
        ? { local_field_id: filters.local_field_id }
        : {}),
      ...(filters.active !== undefined ? { active: filters.active } : {}),
      ...(filters.q
        ? { name: { contains: filters.q, mode: 'insensitive' as const } }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.camporee_venues.findMany({
        where,
        orderBy: { name: 'asc' },
        take: filters.limit ?? 100,
        skip: filters.offset ?? 0,
        include: {
          union: { select: { union_id: true, name: true } },
          local_field: { select: { local_field_id: true, name: true } },
        },
      }),
      this.prisma.camporee_venues.count({ where }),
    ]);

    return { data, total };
  }

  // ─── Get single venue ─────────────────────────────────────────────────────

  async getVenueById(venueId: number) {
    const venue = await this.prisma.camporee_venues.findUnique({
      where: { camporee_venue_id: venueId },
      include: {
        union: { select: { union_id: true, name: true } },
        local_field: { select: { local_field_id: true, name: true } },
      },
    });
    if (!venue) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_VENUE_NOT_FOUND, {
        id: venueId,
      });
    }
    return venue;
  }

  // ─── List venues for a specific camporee ─────────────────────────────────

  async listVenuesForCamporee(camporeeId: number, scope: CamporeeScope) {
    if (scope === 'local') {
      const camporee = await this.prisma.local_camporees.findUnique({
        where: { local_camporee_id: camporeeId },
        select: {
          local_field_id: true,
          local_fields: { select: { union_id: true } },
        },
      });
      if (!camporee) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
          { id: camporeeId },
        );
      }

      const unionId = camporee.local_fields.union_id;
      const localFieldId = camporee.local_field_id;

      return this.prisma.camporee_venues.findMany({
        where: {
          active: true,
          OR: [
            { scope: 'union', union_id: unionId },
            { scope: 'local_field', local_field_id: localFieldId },
          ],
        },
        orderBy: { name: 'asc' },
        include: {
          union: { select: { union_id: true, name: true } },
          local_field: { select: { local_field_id: true, name: true } },
        },
      });
    } else {
      const camporee = await this.prisma.union_camporees.findUnique({
        where: { union_camporee_id: camporeeId },
        select: { union_id: true },
      });
      if (!camporee) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
          { id: camporeeId },
        );
      }

      return this.prisma.camporee_venues.findMany({
        where: {
          active: true,
          scope: 'union',
          union_id: camporee.union_id,
        },
        orderBy: { name: 'asc' },
        include: {
          union: { select: { union_id: true, name: true } },
          local_field: { select: { local_field_id: true, name: true } },
        },
      });
    }
  }

  // ─── Create venue ─────────────────────────────────────────────────────────

  async createVenue(dto: CreateCamporeeVenueDto, actorId: string) {
    this.validateScopeXOR(dto);

    const venue = await this.prisma.camporee_venues.create({
      data: {
        scope: dto.scope,
        union_id: dto.union_id ?? null,
        local_field_id: dto.local_field_id ?? null,
        name: dto.name,
        description: dto.description ?? null,
        capacity: dto.capacity ?? null,
        active: dto.active ?? true,
        created_by: actorId,
        modified_by: actorId,
      },
      include: {
        union: { select: { union_id: true, name: true } },
        local_field: { select: { local_field_id: true, name: true } },
      },
    });

    this.logMutation('create', venue.camporee_venue_id, actorId);
    return venue;
  }

  // ─── Auto-scoped create for local camporee ────────────────────────────────

  async createVenueForLocalCamporee(
    camporeeId: number,
    dto: Omit<CreateCamporeeVenueDto, 'scope' | 'union_id' | 'local_field_id'>,
    actorId: string,
  ) {
    const camporee = await this.prisma.local_camporees.findUnique({
      where: { local_camporee_id: camporeeId },
      select: { local_field_id: true },
    });
    if (!camporee) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
        { id: camporeeId },
      );
    }

    return this.createVenue(
      {
        scope: 'local_field',
        local_field_id: camporee.local_field_id,
        ...dto,
      },
      actorId,
    );
  }

  // ─── Auto-scoped create for union camporee ────────────────────────────────

  async createVenueForUnionCamporee(
    camporeeId: number,
    dto: Omit<CreateCamporeeVenueDto, 'scope' | 'union_id' | 'local_field_id'>,
    actorId: string,
  ) {
    const camporee = await this.prisma.union_camporees.findUnique({
      where: { union_camporee_id: camporeeId },
      select: { union_id: true },
    });
    if (!camporee) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
        { id: camporeeId },
      );
    }

    return this.createVenue(
      {
        scope: 'union',
        union_id: camporee.union_id,
        ...dto,
      },
      actorId,
    );
  }

  // ─── Update venue ─────────────────────────────────────────────────────────

  async updateVenue(
    venueId: number,
    dto: UpdateCamporeeVenueDto,
    actorId: string,
  ) {
    const existing = await this.ensureVenueExists(venueId);

    // If scope-related fields are being changed, re-validate XOR
    if (dto.scope !== undefined) {
      this.validateScopeXOR({
        scope: dto.scope,
        union_id: dto.union_id ?? (existing.scope === 'union' ? (existing.union_id ?? undefined) : undefined),
        local_field_id:
          dto.local_field_id ??
          (existing.scope === 'local_field' ? (existing.local_field_id ?? undefined) : undefined),
      });
    }

    const updated = await this.prisma.camporee_venues.update({
      where: { camporee_venue_id: venueId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
        ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
        ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
        ...(dto.union_id !== undefined ? { union_id: dto.union_id } : {}),
        ...(dto.local_field_id !== undefined
          ? { local_field_id: dto.local_field_id }
          : {}),
        modified_by: actorId,
        modified_at: new Date(),
      },
      include: {
        union: { select: { union_id: true, name: true } },
        local_field: { select: { local_field_id: true, name: true } },
      },
    });

    this.logMutation('update', venueId, actorId);
    return updated;
  }

  // ─── Soft delete venue ────────────────────────────────────────────────────

  async deleteVenue(venueId: number, actorId: string) {
    await this.ensureVenueExists(venueId);

    await this.prisma.camporee_venues.update({
      where: { camporee_venue_id: venueId },
      data: { active: false, modified_by: actorId, modified_at: new Date() },
    });

    this.logMutation('delete', venueId, actorId);
  }
}
