import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AppNotFoundException,
  AppBadRequestException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import {
  CreateCamporeeEventTemplateDto,
  ListCamporeeEventTemplatesDto,
  UpdateCamporeeEventTemplateDto,
} from './dto';

@Injectable()
export class CamporeeEventTemplatesService {
  private readonly logger = new Logger(CamporeeEventTemplatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Determine if the caller is a super-admin or global admin.
   */
  private isSuperOrAdmin(authorization: AuthorizationSnapshot): boolean {
    return authorization.grants.global_roles.some((g) =>
      ['super-admin', 'admin'].includes(g.role_name),
    );
  }

  /**
   * Get the union_id from the user's global role grants (director-union / assistant-union).
   */
  private getUnionIdFromGrant(authorization: AuthorizationSnapshot): number | null {
    const grant = authorization.grants.global_roles.find((g) =>
      ['director-union', 'assistant-union'].includes(g.role_name),
    );
    return (grant as any)?.union_id ?? null;
  }

  /**
   * Get the local_field_id from the user's global role grants (director-lf / assistant-lf).
   */
  private getLfIdFromGrant(authorization: AuthorizationSnapshot): number | null {
    const grant = authorization.grants.global_roles.find((g) =>
      ['director-lf', 'assistant-lf'].includes(g.role_name),
    );
    return (grant as any)?.local_field_id ?? null;
  }

  /**
   * Build the Prisma `where` clause based on role visibility rules:
   * - super-admin / admin: see all
   * - director/assistant-union: own union templates + local_field templates under that union
   * - director/assistant-lf: own local_field templates + parent union templates
   * - director/deputy-director (CLUB): read only — same as lf admin visibility
   */
  private buildVisibilityWhere(
    authorization: AuthorizationSnapshot,
    filters: ListCamporeeEventTemplatesDto,
  ) {
    const base: Record<string, any> = {};

    if (filters.active !== undefined) base.active = filters.active;
    if (filters.event_type_id) base.event_type_id = filters.event_type_id;

    if (this.isSuperOrAdmin(authorization)) {
      // See everything; apply optional scope filters
      if (filters.scope) base.scope = filters.scope;
      if (filters.union_id) base.union_id = filters.union_id;
      if (filters.local_field_id) base.local_field_id = filters.local_field_id;
      return base;
    }

    const unionId = this.getUnionIdFromGrant(authorization);
    if (unionId) {
      // Union admin: sees own union templates + local_field templates of child LFs
      return {
        ...base,
        OR: [
          { scope: 'union', union_id: unionId },
          {
            scope: 'local_field',
            local_field: { union_id: unionId },
          },
        ],
      };
    }

    const lfId = this.getLfIdFromGrant(authorization);
    if (lfId) {
      // LF admin: sees own LF templates + parent union templates
      // We need the union_id of the local field to fetch union templates
      return {
        ...base,
        OR: [
          { scope: 'local_field', local_field_id: lfId },
          {
            scope: 'union',
            union: { local_fields: { some: { local_field_id: lfId } } },
          },
        ],
      };
    }

    // Club director/deputy-director: same as LF visibility based on club's LF
    // For now return empty result — club role scoping requires club context
    // which is not in global_roles. Return nothing visible at template level.
    return { ...base, event_template_id: -1 }; // No results
  }

  async listTemplates(
    authorization: AuthorizationSnapshot,
    filters: ListCamporeeEventTemplatesDto,
  ) {
    const where = this.buildVisibilityWhere(authorization, filters);

    return this.prisma.camporee_event_templates.findMany({
      where,
      orderBy: { event_template_id: 'asc' },
      take: 500,
      include: {
        event_type: true,
      },
    });
  }

  async getTemplate(
    templateId: number,
    authorization: AuthorizationSnapshot,
  ) {
    const template = await this.prisma.camporee_event_templates.findUnique({
      where: { event_template_id: templateId },
      include: { event_type: true },
    });

    if (!template) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_NOT_FOUND,
        { id: templateId },
      );
    }

    // Verify visibility
    const visibleWhere = this.buildVisibilityWhere(authorization, {});
    await this.assertTemplateVisible(template, visibleWhere, authorization);

    return template;
  }

  async createTemplate(
    dto: CreateCamporeeEventTemplateDto,
    authorization: AuthorizationSnapshot,
    actorId: string,
  ) {
    this.validateScopePayload(dto.scope, dto.union_id, dto.local_field_id);
    this.validatePoints(dto.max_points, dto.min_points ?? 0);
    this.validateParticipants(dto.participants_mode, dto.participants_count, dto.participants_by_class);
    await this.assertCanMutateScope(dto.scope, dto.union_id, dto.local_field_id, authorization);

    await this.ensureEventTypeExists(dto.event_type_id);

    const template = await this.prisma.camporee_event_templates.create({
      data: {
        scope: dto.scope,
        union_id: dto.union_id ?? null,
        local_field_id: dto.local_field_id ?? null,
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
        active: dto.active ?? true,
        created_by: actorId,
        modified_by: actorId,
      },
    });

    this.logger.log(
      JSON.stringify({
        action: 'create',
        resource: 'camporee_event_templates',
        resourceId: template.event_template_id,
        actorId,
        timestamp: new Date().toISOString(),
      }),
    );

    return template;
  }

  async updateTemplate(
    templateId: number,
    dto: UpdateCamporeeEventTemplateDto,
    authorization: AuthorizationSnapshot,
    actorId: string,
  ) {
    const existing = await this.prisma.camporee_event_templates.findUnique({
      where: { event_template_id: templateId },
    });

    if (!existing) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_NOT_FOUND,
        { id: templateId },
      );
    }

    // Only owner-scope admins can mutate
    await this.assertCanMutateScope(
      existing.scope,
      existing.union_id ?? undefined,
      existing.local_field_id ?? undefined,
      authorization,
    );

    const maxPoints = dto.max_points ?? existing.max_points;
    const minPoints = dto.min_points ?? existing.min_points;
    this.validatePoints(maxPoints, minPoints);

    const participantsMode = dto.participants_mode ?? existing.participants_mode;
    const participantsCount = dto.participants_count ?? existing.participants_count ?? undefined;
    const participantsByClass = dto.participants_by_class ?? (existing.participants_by_class ? existing.participants_by_class as object[] : undefined);
    this.validateParticipants(participantsMode, participantsCount, participantsByClass);

    if (dto.event_type_id) {
      await this.ensureEventTypeExists(dto.event_type_id);
    }

    const updated = await this.prisma.camporee_event_templates.update({
      where: { event_template_id: templateId },
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

    this.logger.log(
      JSON.stringify({
        action: 'update',
        resource: 'camporee_event_templates',
        resourceId: templateId,
        actorId,
        timestamp: new Date().toISOString(),
      }),
    );

    return updated;
  }

  async deleteTemplate(
    templateId: number,
    authorization: AuthorizationSnapshot,
    actorId: string,
  ) {
    const existing = await this.prisma.camporee_event_templates.findUnique({
      where: { event_template_id: templateId },
    });

    if (!existing) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_NOT_FOUND,
        { id: templateId },
      );
    }

    await this.assertCanMutateScope(
      existing.scope,
      existing.union_id ?? undefined,
      existing.local_field_id ?? undefined,
      authorization,
    );

    const updated = await this.prisma.camporee_event_templates.update({
      where: { event_template_id: templateId },
      data: { active: false, modified_at: new Date(), modified_by: actorId },
    });

    this.logger.log(
      JSON.stringify({
        action: 'delete',
        resource: 'camporee_event_templates',
        resourceId: templateId,
        actorId,
        timestamp: new Date().toISOString(),
      }),
    );

    return updated;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private validateScopePayload(
    scope: string,
    unionId?: number,
    localFieldId?: number,
  ) {
    if (scope === 'union' && !unionId) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_SCOPE_INVALID,
      );
    }
    if (scope === 'local_field' && !localFieldId) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_SCOPE_INVALID,
      );
    }
    if (scope === 'union' && localFieldId) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_SCOPE_INVALID,
      );
    }
    if (scope === 'local_field' && unionId) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_SCOPE_INVALID,
      );
    }
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
    count?: number,
    byClass?: object[],
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

  private async assertCanMutateScope(
    scope: string,
    unionId: number | undefined,
    localFieldId: number | undefined,
    authorization: AuthorizationSnapshot,
  ) {
    if (this.isSuperOrAdmin(authorization)) return;

    if (scope === 'union') {
      const grantUnionId = this.getUnionIdFromGrant(authorization);
      if (!grantUnionId || grantUnionId !== unionId) {
        throw new ForbiddenException(
          ErrorCode.CAMPOREE_EVENT_TEMPLATE_ACCESS_DENIED,
        );
      }
      return;
    }

    if (scope === 'local_field') {
      const grantLfId = this.getLfIdFromGrant(authorization);
      if (!grantLfId || grantLfId !== localFieldId) {
        throw new ForbiddenException(
          ErrorCode.CAMPOREE_EVENT_TEMPLATE_ACCESS_DENIED,
        );
      }
      return;
    }

    throw new ForbiddenException(ErrorCode.CAMPOREE_EVENT_TEMPLATE_ACCESS_DENIED);
  }

  private async assertTemplateVisible(
    template: any,
    _visibleWhere: any,
    authorization: AuthorizationSnapshot,
  ) {
    if (this.isSuperOrAdmin(authorization)) return;

    const unionId = this.getUnionIdFromGrant(authorization);
    const lfId = this.getLfIdFromGrant(authorization);

    if (unionId) {
      if (template.scope === 'union' && template.union_id === unionId) return;
      if (template.scope === 'local_field') {
        // Check if the LF belongs to this union
        const lf = await this.prisma.local_fields.findUnique({
          where: { local_field_id: template.local_field_id! },
          select: { union_id: true },
        });
        if (lf?.union_id === unionId) return;
      }
    }

    if (lfId) {
      if (template.scope === 'local_field' && template.local_field_id === lfId) return;
      if (template.scope === 'union') {
        const lf = await this.prisma.local_fields.findUnique({
          where: { local_field_id: lfId },
          select: { union_id: true },
        });
        if (lf?.union_id === template.union_id) return;
      }
    }

    throw new ForbiddenException(ErrorCode.CAMPOREE_EVENT_TEMPLATE_ACCESS_DENIED);
  }

  private async ensureEventTypeExists(eventTypeId: number) {
    const exists = await this.prisma.camporee_event_types.findUnique({
      where: { event_type_id: eventTypeId },
    });

    if (!exists || !exists.active) {
      throw new AppNotFoundException(
        ErrorCode.ADMIN_CAMPOREE_EVENT_TYPE_NOT_FOUND,
        { id: eventTypeId },
      );
    }
  }
}
