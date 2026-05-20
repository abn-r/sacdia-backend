import { Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  CloneFromTemplateDto,
  CreateCamporeeEventDto,
  ReorderCamporeeEventDto,
  UpdateCamporeeEventDto,
} from './dto';

type CamporeeScope = 'local' | 'union';

@Injectable()
export class CamporeeEventsService {
  private readonly logger = new Logger(CamporeeEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private logMutation(
    action: string,
    resourceId: number,
    actorId: string,
  ) {
    this.logger.log(
      JSON.stringify({
        action,
        resource: 'camporee_events',
        resourceId,
        actorId,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  private validatePoints(maxPoints: number, minPoints: number) {
    if (maxPoints < minPoints) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_POINTS_INVALID,
      );
    }
  }

  private validateParticipants(
    mode: string,
    count?: number | null,
    byClass?: object[] | null,
  ) {
    if (mode === 'count' && (!count || count < 1)) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_PARTICIPANTS_INVALID,
      );
    }
    if (mode === 'by_class' && (!byClass || byClass.length === 0)) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_PARTICIPANTS_INVALID,
      );
    }
  }

  private async ensureCamporeeExists(
    camporeeId: number,
    scope: CamporeeScope,
  ) {
    if (scope === 'local') {
      const camporee = await this.prisma.local_camporees.findUnique({
        where: { local_camporee_id: camporeeId },
      });
      if (!camporee) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
          { id: camporeeId },
        );
      }
      return camporee;
    } else {
      const camporee = await this.prisma.union_camporees.findUnique({
        where: { union_camporee_id: camporeeId },
      });
      if (!camporee) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
          { id: camporeeId },
        );
      }
      return camporee;
    }
  }

  private async ensureEventExists(eventId: number) {
    const event = await this.prisma.camporee_events.findUnique({
      where: { camporee_event_id: eventId },
    });
    if (!event) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_EVENT_NOT_FOUND,
        { id: eventId },
      );
    }
    return event;
  }

  private async getNextDisplayOrder(
    camporeeId: number,
    scope: CamporeeScope,
  ): Promise<number> {
    const where =
      scope === 'local'
        ? { local_camporee_id: camporeeId }
        : { union_camporee_id: camporeeId };

    const last = await this.prisma.camporee_events.findFirst({
      where,
      orderBy: { display_order: 'desc' },
      select: { display_order: true },
    });

    return (last?.display_order ?? -1) + 1;
  }

  // ─── List events for a camporee ──────────────────────────────────────────

  async listEvents(camporeeId: number, scope: CamporeeScope) {
    await this.ensureCamporeeExists(camporeeId, scope);

    const where =
      scope === 'local'
        ? { local_camporee_id: camporeeId }
        : { union_camporee_id: camporeeId };

    return this.prisma.camporee_events.findMany({
      where: { ...where, active: true },
      orderBy: { display_order: 'asc' },
      include: { event_type: true },
    });
  }

  // ─── Create custom event ─────────────────────────────────────────────────

  async createEvent(
    camporeeId: number,
    scope: CamporeeScope,
    dto: CreateCamporeeEventDto,
    actorId: string,
  ) {
    await this.ensureCamporeeExists(camporeeId, scope);
    this.validatePoints(dto.max_points, dto.min_points ?? 0);
    this.validateParticipants(
      dto.participants_mode,
      dto.participants_count,
      dto.participants_by_class as object[] | undefined,
    );

    const eventType = await this.prisma.camporee_event_types.findUnique({
      where: { event_type_id: dto.event_type_id },
    });
    if (!eventType || !eventType.active) {
      throw new AppNotFoundException(
        ErrorCode.ADMIN_CAMPOREE_EVENT_TYPE_NOT_FOUND,
        { id: dto.event_type_id },
      );
    }

    const displayOrder =
      dto.display_order ?? (await this.getNextDisplayOrder(camporeeId, scope));

    const event = await this.prisma.camporee_events.create({
      data: {
        ...(scope === 'local'
          ? { local_camporee_id: camporeeId }
          : { union_camporee_id: camporeeId }),
        event_type_id: dto.event_type_id,
        title: dto.title,
        description: dto.description ?? null,
        requirements: dto.requirements ?? null,
        development: dto.development ?? null,
        prerequisites: dto.prerequisites ?? null,
        materials: dto.materials ?? null,
        auxiliaries: dto.auxiliaries ?? null,
        max_points: dto.max_points,
        min_points: dto.min_points ?? 0,
        penalties: (dto.penalties ?? []) as any,
        participants_mode: dto.participants_mode,
        participants_count: dto.participants_count ?? null,
        participants_by_class: (dto.participants_by_class ?? null) as any,
        duration_seconds: dto.duration_seconds ?? null,
        display_order: displayOrder,
        active: dto.active ?? true,
        created_by: actorId,
        modified_by: actorId,
      },
    });

    this.logMutation('create', event.camporee_event_id, actorId);
    return event;
  }

  // ─── Clone from template ─────────────────────────────────────────────────

  async createFromTemplate(
    camporeeId: number,
    scope: CamporeeScope,
    templateId: number,
    dto: CloneFromTemplateDto,
    actorId: string,
  ) {
    await this.ensureCamporeeExists(camporeeId, scope);

    const template = await this.prisma.camporee_event_templates.findUnique({
      where: { event_template_id: templateId },
    });

    if (!template || !template.active) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_NOT_FOUND,
        { id: templateId },
      );
    }

    const displayOrder =
      dto.display_order ?? (await this.getNextDisplayOrder(camporeeId, scope));

    const event = await this.prisma.camporee_events.create({
      data: {
        ...(scope === 'local'
          ? { local_camporee_id: camporeeId }
          : { union_camporee_id: camporeeId }),
        event_template_id: templateId,
        event_type_id: template.event_type_id,
        // Apply overrides from dto, fallback to template values
        title: dto.title ?? template.title,
        description: template.description,
        requirements: template.requirements,
        development: template.development,
        prerequisites: template.prerequisites,
        materials: template.materials,
        auxiliaries: template.auxiliaries,
        max_points: dto.max_points ?? template.max_points,
        min_points: template.min_points,
        penalties: template.penalties as any,
        participants_mode: template.participants_mode,
        participants_count: template.participants_count,
        participants_by_class: template.participants_by_class as any,
        duration_seconds: template.duration_seconds,
        display_order: displayOrder,
        active: true,
        created_by: actorId,
        modified_by: actorId,
      },
    });

    this.logMutation('create_from_template', event.camporee_event_id, actorId);
    return event;
  }

  // ─── Update event instance ───────────────────────────────────────────────

  async updateEvent(
    eventId: number,
    dto: UpdateCamporeeEventDto,
    actorId: string,
  ) {
    const existing = await this.ensureEventExists(eventId);

    const maxPoints = dto.max_points ?? existing.max_points;
    const minPoints = dto.min_points ?? existing.min_points;
    this.validatePoints(maxPoints, minPoints);

    const participantsMode = dto.participants_mode ?? existing.participants_mode;
    const participantsCount = dto.participants_count ?? existing.participants_count;
    const participantsByClass =
      dto.participants_by_class ?? (existing.participants_by_class as object[] | null);
    this.validateParticipants(participantsMode, participantsCount, participantsByClass);

    if (dto.event_type_id) {
      const eventType = await this.prisma.camporee_event_types.findUnique({
        where: { event_type_id: dto.event_type_id },
      });
      if (!eventType || !eventType.active) {
        throw new AppNotFoundException(
          ErrorCode.ADMIN_CAMPOREE_EVENT_TYPE_NOT_FOUND,
          { id: dto.event_type_id },
        );
      }
    }

    const updated = await this.prisma.camporee_events.update({
      where: { camporee_event_id: eventId },
      data: {
        ...(dto.event_type_id ? { event_type_id: dto.event_type_id } : {}),
        ...(dto.title ? { title: dto.title } : {}),
        ...(typeof dto.description === 'string' ? { description: dto.description } : {}),
        ...(typeof dto.requirements === 'string' ? { requirements: dto.requirements } : {}),
        ...(typeof dto.development === 'string' ? { development: dto.development } : {}),
        ...(typeof dto.prerequisites === 'string' ? { prerequisites: dto.prerequisites } : {}),
        ...(typeof dto.materials === 'string' ? { materials: dto.materials } : {}),
        ...(typeof dto.auxiliaries === 'string' ? { auxiliaries: dto.auxiliaries } : {}),
        ...(dto.max_points !== undefined ? { max_points: dto.max_points } : {}),
        ...(dto.min_points !== undefined ? { min_points: dto.min_points } : {}),
        ...(dto.penalties !== undefined ? { penalties: dto.penalties as any } : {}),
        ...(dto.participants_mode ? { participants_mode: dto.participants_mode } : {}),
        ...(dto.participants_count !== undefined ? { participants_count: dto.participants_count } : {}),
        ...(dto.participants_by_class !== undefined ? { participants_by_class: dto.participants_by_class as any } : {}),
        ...(dto.duration_seconds !== undefined ? { duration_seconds: dto.duration_seconds } : {}),
        ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
        modified_by: actorId,
        modified_at: new Date(),
      },
    });

    this.logMutation('update', eventId, actorId);
    return updated;
  }

  // ─── Delete event instance ───────────────────────────────────────────────

  async deleteEvent(eventId: number, actorId: string) {
    await this.ensureEventExists(eventId);

    const deleted = await this.prisma.camporee_events.update({
      where: { camporee_event_id: eventId },
      data: { active: false, modified_at: new Date(), modified_by: actorId },
    });

    this.logMutation('delete', eventId, actorId);
    return deleted;
  }

  // ─── Reorder ─────────────────────────────────────────────────────────────

  async reorderEvent(
    eventId: number,
    dto: ReorderCamporeeEventDto,
    actorId: string,
  ) {
    await this.ensureEventExists(eventId);

    const updated = await this.prisma.camporee_events.update({
      where: { camporee_event_id: eventId },
      data: {
        display_order: dto.display_order,
        modified_by: actorId,
        modified_at: new Date(),
      },
    });

    this.logMutation('reorder', eventId, actorId);
    return updated;
  }
}
