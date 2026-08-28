import { Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppNotFoundException,
  AppUnprocessableEntityException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../common/services/authorization-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CamporeeStaffService } from '../camporee-staff/camporee-staff.service';
import {
  CloneFromTemplateDto,
  CreateCamporeeEventDto,
  ListCamporeeEventsFilterDto,
  ReplaceCamporeeEventScheduleBlocksDto,
  ReplaceCamporeeEventStaffAssignmentsDto,
  ReorderCamporeeEventDto,
  UpdateCamporeeEventDto,
  CamporeeEventScheduleBlockDto,
  CamporeeEventStatusDto,
} from './dto';

type CamporeeScope = 'local' | 'union';
type CamporeeEventStatusValue = `${CamporeeEventStatusDto}`;
type ResolvedScheduleBlockAssignment = {
  camporee_club_id: number | null;
  club_section_id: number;
};
type ScheduleBlockWithAssignments = {
  block: CamporeeEventScheduleBlockDto;
  assignments: ResolvedScheduleBlockAssignment[];
  index: number;
};

// Status transition table — forward-only machine (Spec C5).
// `realizado` and `cancelado` are TERMINAL states: no further transitions.
const STATUS_TRANSITIONS: Record<
  CamporeeEventStatusValue,
  CamporeeEventStatusValue[]
> = {
  programado: [
    CamporeeEventStatusDto.publicado,
    CamporeeEventStatusDto.cancelado,
  ],
  publicado: [
    CamporeeEventStatusDto.en_curso,
    CamporeeEventStatusDto.cancelado,
  ],
  en_curso: [
    CamporeeEventStatusDto.realizado,
    CamporeeEventStatusDto.cancelado,
  ],
  realizado: [], // terminal
  cancelado: [], // terminal — Spec C5 / Scenario 5.6
};

const MAX_EVENT_HONORS = 20;

@Injectable()
export class CamporeeEventsService {
  private readonly logger = new Logger(CamporeeEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly camporeeStaffService: CamporeeStaffService,
  ) {}

  private logMutation(action: string, resourceId: number, actorId: string) {
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

  private async assertMaxPointsMatchesActiveRubrics(
    eventId: number,
    maxPoints: number,
  ) {
    const rubrics = await this.prisma.camporee_event_rubrics.findMany({
      where: { camporee_event_id: eventId, active: true },
      select: { max_points: true },
    });
    if (rubrics.length === 0) {
      return;
    }

    const rubricSum = rubrics.reduce(
      (total, rubric) => total + Number(rubric.max_points),
      0,
    );
    if (Math.abs(rubricSum - maxPoints) > 0.001) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_SCORING_RUBRIC_SUM_MISMATCH,
        { sum: rubricSum, maxPoints },
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

  private async ensureCamporeeExists(camporeeId: number, scope: CamporeeScope) {
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
      throw new AppNotFoundException(ErrorCode.CAMPOREE_EVENT_NOT_FOUND, {
        id: eventId,
      });
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

  // ─── Helpers (camporee-agenda-events) ────────────────────────────────────

  /**
   * Validates sections[] against camporee's includes_* flags.
   * Empty array skips validation (means "all sections of camporee").
   */
  async validateSectionsAgainstCamporee(
    sections: string[],
    ctx: {
      local_camporee_id?: number | null;
      union_camporee_id?: number | null;
    },
  ): Promise<void> {
    if (!sections?.length) return;

    const allowed = new Set<string>();

    if (ctx.local_camporee_id) {
      const camporee = await this.prisma.local_camporees.findUnique({
        where: { local_camporee_id: ctx.local_camporee_id },
        select: {
          includes_adventurers: true,
          includes_pathfinders: true,
          includes_master_guides: true,
        },
      });
      if (!camporee) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
          { id: ctx.local_camporee_id },
        );
      }
      if (camporee.includes_adventurers) allowed.add('adventurers');
      if (camporee.includes_pathfinders) allowed.add('pathfinders');
      if (camporee.includes_master_guides) allowed.add('master_guides');
    } else if (ctx.union_camporee_id) {
      const camporee = await this.prisma.union_camporees.findUnique({
        where: { union_camporee_id: ctx.union_camporee_id },
        select: {
          includes_adventurers: true,
          includes_pathfinders: true,
          includes_master_guides: true,
        },
      });
      if (!camporee) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
          { id: ctx.union_camporee_id },
        );
      }
      if (camporee.includes_adventurers) allowed.add('adventurers');
      if (camporee.includes_pathfinders) allowed.add('pathfinders');
      if (camporee.includes_master_guides) allowed.add('master_guides');
    }

    const offending = sections.filter((s) => !allowed.has(s));
    if (offending.length) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_SECTIONS_INVALID,
        {
          offending,
          message: `Sections not enabled for this camporee: ${offending.join(', ')}`,
        },
      );
    }
  }

  /**
   * Validates leader assignment (Spec C3 — precedence, not XOR).
   *
   * Spec §C3: "if both are provided in a mutation, leader_user_id takes
   * precedence and leader_name_override MUST be persisted as sent (it is
   * stored for record, not discarded)." Both null is fine (no leader).
   *
   * This validator is intentionally a no-op for shape — persistence is
   * handled in create/update, and display resolution prefers FK at read time.
   * It is kept as a hook for future business rules (e.g. role required when
   * a leader is set).
   */
  validateLeader(_dto: {
    leader_user_id?: string | null;
    leader_name_override?: string | null;
  }): void {
    // No-op: both fields may coexist per Spec C3.
  }

  /**
   * Enforces forward-only status state machine.
   * No-op when current === next.
   * Throws 422 on invalid transition.
   */
  enforceStatusTransition(
    current: CamporeeEventStatusValue,
    next: CamporeeEventStatusValue,
  ): void {
    if (current === next) return;
    const allowed = STATUS_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new AppUnprocessableEntityException(
        ErrorCode.CAMPOREE_EVENT_STATUS_TRANSITION_INVALID,
        { current, next, allowed },
      );
    }
  }

  /**
   * Resolves the default `general` camporee_event_type used by agenda
   * events when callers omit `event_type_id`. The row is seeded by migration
   * `20260521120000_camporee_event_type_general` (idempotent via ON CONFLICT
   * on `code`).
   */
  async resolveDefaultAgendaEventType() {
    return this.prisma.camporee_event_types.findFirst({
      where: { code: 'general', active: true },
    });
  }

  private hasPermission(
    resolved: ResolvedAuthorizationProfile,
    permission: string,
  ): boolean {
    return resolved.authorization.effective.permissions.includes(permission);
  }

  private async canManageAgenda(actorUserId?: string): Promise<boolean> {
    if (!actorUserId) return false;
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorUserId);
    return (
      this.hasPermission(resolved, 'camporee_events:create') ||
      this.hasPermission(resolved, 'camporee_events:update') ||
      this.hasPermission(resolved, 'camporee_events:delete')
    );
  }

  private getAgendaVisibleFrom(camporee: {
    start_date: Date;
    agenda_visible_from?: Date | null;
  }): Date {
    return camporee.agenda_visible_from ?? camporee.start_date;
  }

  private async resolveAgendaVisibility(
    camporeeId: number,
    scope: CamporeeScope,
  ): Promise<{ visible: boolean; visibleFrom: Date }> {
    const camporee = await this.ensureCamporeeExists(camporeeId, scope);
    const visibleFrom = this.getAgendaVisibleFrom(camporee);
    return { visible: Date.now() >= visibleFrom.getTime(), visibleFrom };
  }

  private maskAgendaDetails<T extends Record<string, any>>(event: T): T {
    return {
      ...event,
      agenda_visible: false,
      day_number: 1,
      starts_at: null,
      ends_at: null,
      venue_id: null,
      leader_user_id: null,
      leader_name_override: null,
      leader_role: null,
      status: 'programado',
      capacity: null,
      registered_count: 0,
      venue: null,
      leader: null,
      schedule_blocks: [],
      staff_assignments: [],
    };
  }

  private mapEventStaffAssignment(row: any) {
    const staff = row.camporee_staff_member;
    const user = staff?.user;
    return {
      camporee_event_staff_assignment_id:
        row.camporee_event_staff_assignment_id,
      camporee_event_id: row.camporee_event_id,
      camporee_staff_member_id: row.camporee_staff_member_id,
      assignment_role: row.assignment_role,
      title_override: row.title_override ?? null,
      notes: row.notes ?? null,
      display_order: row.display_order,
      active: row.active,
      staff_member: staff
        ? {
            camporee_staff_member_id: staff.camporee_staff_member_id,
            category: staff.category,
            role_label: staff.role_label ?? null,
            user_id: staff.user_id,
            user: user
              ? {
                  user_id: user.user_id,
                  name: user.name ?? null,
                  paternal_last_name: user.paternal_last_name ?? null,
                  maternal_last_name: user.maternal_last_name ?? null,
                  full_name: [
                    user.name,
                    user.paternal_last_name,
                    user.maternal_last_name,
                  ]
                    .filter(Boolean)
                    .join(' ')
                    .trim(),
                  user_image: user.user_image ?? null,
                }
              : null,
          }
        : null,
    };
  }

  private async loadEventStaffAssignments(eventIds: number[]) {
    if (!eventIds.length) return new Map<number, any[]>();

    const rows = await (
      this.prisma as any
    ).camporee_event_staff_assignments.findMany({
      where: {
        camporee_event_id: { in: eventIds },
        active: true,
        camporee_staff_member: {
          is: { active: true, status: 'active' },
        },
      },
      include: {
        camporee_staff_member: {
          include: {
            user: {
              select: {
                user_id: true,
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
                user_image: true,
              },
            },
          },
        },
      },
      orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
    });

    const byEvent = new Map<number, any[]>();
    for (const row of rows) {
      const list = byEvent.get(row.camporee_event_id) ?? [];
      list.push(this.mapEventStaffAssignment(row));
      byEvent.set(row.camporee_event_id, list);
    }
    return byEvent;
  }

  private attachEventStaffAssignments<T extends Record<string, any>>(
    events: T[],
    staffByEvent: Map<number, any[]>,
  ): T[] {
    return events.map((event) => ({
      ...event,
      staff_assignments: staffByEvent.get(event.camporee_event_id) ?? [],
    }));
  }

  private mapEventHonor(row: {
    display_order: number;
    honor: {
      honor_id: number;
      name: string;
      honor_image: string;
      material_url: string;
      honors_category_id: number;
      skill_level: number;
      active: boolean;
      honors_categories?: { name: string } | null;
    };
  }) {
    return {
      honor_id: row.honor.honor_id,
      name: row.honor.name,
      honor_image: row.honor.honor_image,
      material_url: row.honor.material_url,
      honors_category_id: row.honor.honors_category_id,
      category_name: row.honor.honors_categories?.name ?? null,
      skill_level: row.honor.skill_level,
      active: row.honor.active,
      display_order: row.display_order,
    };
  }

  private async loadEventHonors(eventIds: number[]) {
    if (!eventIds.length) return new Map<number, any[]>();

    const rows = await this.prisma.camporee_event_honors.findMany({
      where: { camporee_event_id: { in: eventIds } },
      include: {
        honor: {
          select: {
            honor_id: true,
            name: true,
            honor_image: true,
            material_url: true,
            honors_category_id: true,
            skill_level: true,
            active: true,
            honors_categories: { select: { name: true } },
          },
        },
      },
      orderBy: [{ display_order: 'asc' }, { camporee_event_honor_id: 'asc' }],
    });

    const byEvent = new Map<number, any[]>();
    for (const row of rows) {
      const list = byEvent.get(row.camporee_event_id) ?? [];
      list.push(this.mapEventHonor(row));
      byEvent.set(row.camporee_event_id, list);
    }
    return byEvent;
  }

  private attachEventHonors<T extends Record<string, any>>(
    events: T[],
    honorsByEvent: Map<number, any[]>,
  ): T[] {
    return events.map((event) => ({
      ...event,
      honors: honorsByEvent.get(event.camporee_event_id) ?? [],
    }));
  }

  private async assertHonorIds(honorIds: number[]): Promise<void> {
    if (honorIds.length > MAX_EVENT_HONORS) {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_EVENT_HONOR_LIMIT, {
        limit: MAX_EVENT_HONORS,
        count: honorIds.length,
      });
    }

    const unique = new Set(honorIds);
    if (unique.size !== honorIds.length) {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_EVENT_HONOR_DUPLICATE);
    }

    if (honorIds.length === 0) return;

    const found = await this.prisma.honors.findMany({
      where: { honor_id: { in: honorIds }, active: true },
      select: { honor_id: true },
    });
    const foundIds = new Set(found.map((row) => row.honor_id));
    const missing = honorIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_EVENT_HONOR_NOT_FOUND, {
        honor_ids: missing,
      });
    }
  }

  private async replaceEventHonors(eventId: number, honorIds: number[]) {
    await this.assertHonorIds(honorIds);
    await this.prisma.$transaction(async (tx) => {
      await tx.camporee_event_honors.deleteMany({
        where: { camporee_event_id: eventId },
      });
      if (honorIds.length === 0) return;
      await tx.camporee_event_honors.createMany({
        data: honorIds.map((honorId, displayOrder) => ({
          camporee_event_id: eventId,
          honor_id: honorId,
          display_order: displayOrder,
        })),
      });
    });
  }

  private async ensureResponsibleAssignmentExists(
    eventId: number,
  ): Promise<void> {
    const responsible = await (
      this.prisma as any
    ).camporee_event_staff_assignments.findFirst({
      where: {
        camporee_event_id: eventId,
        assignment_role: 'responsible',
        active: true,
        camporee_staff_member: {
          is: { active: true, status: 'active' },
        },
      },
      select: { camporee_event_staff_assignment_id: true },
    });

    if (!responsible) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_RESPONSIBLE_REQUIRED,
      );
    }
  }

  private async loadScheduleBlocks(eventIds: number[]) {
    if (!eventIds.length) return new Map<number, any[]>();

    const blocks = await (
      this.prisma as any
    ).camporee_event_schedule_blocks.findMany({
      where: { camporee_event_id: { in: eventIds }, active: true },
      include: {
        venue: { select: { camporee_venue_id: true, name: true } },
        assignments: {
          where: { active: true },
          include: {
            camporee_club: {
              select: {
                camporee_club_id: true,
                club_section_id: true,
                status: true,
              },
            },
            club_section: {
              select: {
                club_section_id: true,
                club_type_id: true,
                main_club_id: true,
                clubs: { select: { club_id: true, name: true } },
                club_types: { select: { club_type_id: true, name: true } },
              },
            },
          },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: [
        { day_number: 'asc' },
        { starts_at: 'asc' },
        { display_order: 'asc' },
      ],
    });

    const byEvent = new Map<number, any[]>();
    for (const block of blocks) {
      const list = byEvent.get(block.camporee_event_id) ?? [];
      list.push(block);
      byEvent.set(block.camporee_event_id, list);
    }
    return byEvent;
  }

  private attachScheduleBlocks<T extends Record<string, any>>(
    events: T[],
    blocksByEvent: Map<number, any[]>,
  ): T[] {
    return events.map((event) => ({
      ...event,
      agenda_visible: true,
      schedule_blocks: blocksByEvent.get(event.camporee_event_id) ?? [],
    }));
  }

  /**
   * Resolves the parent camporee for an event — used by RBAC.
   */
  async resolveCamporeeForEvent(
    eventId: number,
  ): Promise<
    { type: 'camporee'; id: number } | { type: 'union_camporee'; id: number }
  > {
    const row = await this.prisma.camporee_events.findUnique({
      where: { camporee_event_id: eventId },
      select: { local_camporee_id: true, union_camporee_id: true },
    });
    if (!row) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_EVENT_NOT_FOUND, {
        id: eventId,
      });
    }
    if (row.local_camporee_id) {
      return { type: 'camporee', id: row.local_camporee_id };
    }
    return { type: 'union_camporee', id: row.union_camporee_id! };
  }

  // ─── List events for a camporee ──────────────────────────────────────────

  async listEventTypes() {
    return this.prisma.camporee_event_types.findMany({
      where: { active: true },
      orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    });
  }

  async listEvents(
    camporeeId: number,
    scope: CamporeeScope,
    filters?: ListCamporeeEventsFilterDto,
    options?: { actorId?: string; allowManagerBypass?: boolean },
  ) {
    const agenda = await this.resolveAgendaVisibility(camporeeId, scope);
    const canManage =
      options?.allowManagerBypass !== false
        ? await this.canManageAgenda(options?.actorId)
        : false;
    const shouldShowAgenda = agenda.visible || canManage;

    const scopeWhere =
      scope === 'local'
        ? { local_camporee_id: camporeeId }
        : { union_camporee_id: camporeeId };

    const where: any = {
      ...scopeWhere,
      active: true,
      ...(filters?.day_number ? { day_number: filters.day_number } : {}),
      ...(filters?.display_category
        ? { display_category: filters.display_category }
        : {}),
      // sections filter: event must contain the value OR have empty sections (matches all)
      ...(filters?.section
        ? {
            OR: [
              { sections: { has: filters.section } },
              { sections: { equals: [] } },
            ],
          }
        : {}),
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.venue_id ? { venue_id: filters.venue_id } : {}),
      ...(filters?.leader_user_id
        ? { leader_user_id: filters.leader_user_id }
        : {}),
      ...(filters?.q
        ? {
            OR: [
              { title: { contains: filters.q, mode: 'insensitive' as const } },
              {
                description: {
                  contains: filters.q,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.camporee_events.findMany({
        where,
        include: {
          event_type: true,
          leader: {
            select: { user_id: true, name: true, paternal_last_name: true },
          },
          venue: {
            select: { camporee_venue_id: true, name: true },
          },
        },
        orderBy: [
          { day_number: 'asc' },
          { starts_at: 'asc' },
          { display_order: 'asc' },
        ],
        take: filters?.limit ?? 100,
        skip: filters?.offset ?? 0,
      }),
      this.prisma.camporee_events.count({ where }),
    ]);

    const blocksByEvent = shouldShowAgenda
      ? await this.loadScheduleBlocks(
          data.map((event) => event.camporee_event_id),
        )
      : new Map<number, any[]>();
    const events = shouldShowAgenda
      ? this.attachScheduleBlocks(data, blocksByEvent)
      : data.map((event) => this.maskAgendaDetails(event));
    const staffByEvent = shouldShowAgenda
      ? await this.loadEventStaffAssignments(
          data.map((event) => event.camporee_event_id),
        )
      : new Map<number, any[]>();
    const eventsWithStaff = shouldShowAgenda
      ? this.attachEventStaffAssignments(events, staffByEvent)
      : events;
    const honorsByEvent = await this.loadEventHonors(
      data.map((event) => event.camporee_event_id),
    );

    return {
      data: this.attachEventHonors(eventsWithStaff, honorsByEvent),
      total,
      agenda_visible: shouldShowAgenda,
      agenda_visible_from: agenda.visibleFrom,
    };
  }

  async getEvent(eventId: number) {
    const event = await this.prisma.camporee_events.findFirst({
      where: { camporee_event_id: eventId, active: true },
      include: {
        event_type: true,
        leader: {
          select: { user_id: true, name: true, paternal_last_name: true },
        },
        venue: {
          select: { camporee_venue_id: true, name: true },
        },
      },
    });

    if (!event) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_EVENT_NOT_FOUND, {
        id: eventId,
      });
    }

    const blocksByEvent = await this.loadScheduleBlocks([
      event.camporee_event_id,
    ]);
    const staffByEvent = await this.loadEventStaffAssignments([
      event.camporee_event_id,
    ]);
    const honorsByEvent = await this.loadEventHonors([
      event.camporee_event_id,
    ]);
    return this.attachEventHonors(
      this.attachEventStaffAssignments(
        this.attachScheduleBlocks([event], blocksByEvent),
        staffByEvent,
      ),
      honorsByEvent,
    )[0];
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
      dto.participants_by_class,
    );

    // Agenda validations
    this.validateLeader({
      leader_user_id: dto.leader_user_id,
      leader_name_override: dto.leader_name_override,
    });

    const camporeeCtx =
      scope === 'local'
        ? { local_camporee_id: camporeeId, union_camporee_id: null }
        : { local_camporee_id: null, union_camporee_id: camporeeId };

    if (dto.sections?.length) {
      await this.validateSectionsAgainstCamporee(dto.sections, camporeeCtx);
    }

    if (dto.status === CamporeeEventStatusDto.publicado) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_RESPONSIBLE_REQUIRED,
      );
    }

    if (dto.honor_ids !== undefined) {
      await this.assertHonorIds(dto.honor_ids);
    }

    const eventType = dto.event_type_id
      ? await this.prisma.camporee_event_types.findUnique({
          where: { event_type_id: dto.event_type_id },
        })
      : await this.resolveDefaultAgendaEventType();
    if (!eventType || !eventType.active) {
      throw new AppNotFoundException(
        ErrorCode.ADMIN_CAMPOREE_EVENT_TYPE_NOT_FOUND,
        { id: dto.event_type_id ?? null, code: 'general' },
      );
    }
    const resolvedEventTypeId = eventType.event_type_id;

    const displayOrder =
      dto.display_order ?? (await this.getNextDisplayOrder(camporeeId, scope));

    const event = await this.prisma.camporee_events.create({
      data: {
        ...(scope === 'local'
          ? { local_camporee_id: camporeeId }
          : { union_camporee_id: camporeeId }),
        event_type_id: resolvedEventTypeId,
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
        // Agenda fields
        day_number: dto.day_number ?? 1,
        starts_at: dto.starts_at ?? null,
        ends_at: dto.ends_at ?? null,
        venue_id: dto.venue_id ?? null,
        leader_user_id: dto.leader_user_id ?? null,
        leader_name_override: dto.leader_name_override ?? null,
        leader_role: dto.leader_role ?? null,
        sections: dto.sections ?? [],
        display_category: dto.display_category ?? 'logistico',
        status: dto.status ?? 'programado',
        capacity: dto.capacity ?? null,
        registered_count: dto.registered_count ?? 0,
        created_by: actorId,
        modified_by: actorId,
      },
      include: {
        event_type: true,
        leader: {
          select: { user_id: true, name: true, paternal_last_name: true },
        },
        venue: { select: { camporee_venue_id: true, name: true } },
      },
    });

    if (dto.schedule_blocks !== undefined) {
      await this.replaceScheduleBlocks(
        event.camporee_event_id,
        { blocks: dto.schedule_blocks },
        actorId,
      );
    }

    if (dto.honor_ids !== undefined) {
      await this.replaceEventHonors(event.camporee_event_id, dto.honor_ids);
    }

    this.logMutation('create', event.camporee_event_id, actorId);
    return this.getEvent(event.camporee_event_id);
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
      include: {
        rubrics: {
          where: { active: true },
          orderBy: [
            { display_order: 'asc' },
            { camporee_event_template_rubric_id: 'asc' },
          ],
        },
      },
    });

    if (!template || !template.active) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_NOT_FOUND,
        { id: templateId },
      );
    }

    const displayOrder =
      dto.display_order ?? (await this.getNextDisplayOrder(camporeeId, scope));
    const maxPoints = dto.max_points ?? template.max_points;

    if (template.scoring_enabled) {
      const rubricSum = template.rubrics.reduce(
        (total, rubric) => total + Number(rubric.max_points),
        0,
      );

      if (template.rubrics.length === 0) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_SCORING_RUBRICS_REQUIRED,
        );
      }

      if (Math.abs(rubricSum - maxPoints) > 0.001) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_SCORING_RUBRIC_SUM_MISMATCH,
          { sum: rubricSum, maxPoints },
        );
      }
    }

    // Clone: only competition fields cloned. Agenda fields NOT cloned per design.
    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.camporee_events.create({
        data: {
          ...(scope === 'local'
            ? { local_camporee_id: camporeeId }
            : { union_camporee_id: camporeeId }),
          event_template_id: templateId,
          event_type_id: template.event_type_id,
          title: dto.title ?? template.title,
          description: template.description,
          requirements: template.requirements,
          development: template.development,
          prerequisites: template.prerequisites,
          materials: template.materials,
          auxiliaries: template.auxiliaries,
          max_points: maxPoints,
          scoring_enabled: template.scoring_enabled,
          min_points: template.min_points,
          penalties: template.penalties as any,
          participants_mode: template.participants_mode,
          participants_count: template.participants_count,
          participants_by_class: template.participants_by_class as any,
          duration_seconds: template.duration_seconds,
          display_order: displayOrder,
          active: true,
          // Agenda defaults on clone
          day_number: 1,
          sections: [],
          display_category: 'logistico',
          status: 'programado',
          registered_count: 0,
          created_by: actorId,
          modified_by: actorId,
        },
      });

      if (template.scoring_enabled) {
        for (const rubric of template.rubrics) {
          await tx.camporee_event_rubrics.create({
            data: {
              camporee_event_id: created.camporee_event_id,
              title: rubric.title,
              description: rubric.description,
              max_points: rubric.max_points,
              display_order: rubric.display_order,
              created_by: actorId,
              modified_by: actorId,
            },
          });
        }
      }

      return created;
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

    if (dto.honor_ids !== undefined) {
      await this.assertHonorIds(dto.honor_ids);
    }

    const maxPoints = dto.max_points ?? existing.max_points;
    const minPoints = dto.min_points ?? existing.min_points;
    this.validatePoints(maxPoints, minPoints);

    const participantsMode =
      dto.participants_mode ?? existing.participants_mode;
    const participantsCount =
      dto.participants_count ?? existing.participants_count;
    const participantsByClass =
      dto.participants_by_class ??
      (existing.participants_by_class as object[] | null);
    this.validateParticipants(
      participantsMode,
      participantsCount,
      participantsByClass,
    );

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

    // Agenda validations
    this.validateLeader({
      leader_user_id: dto.leader_user_id ?? existing.leader_user_id,
      leader_name_override:
        dto.leader_name_override ?? existing.leader_name_override,
    });

    if (dto.sections?.length) {
      await this.validateSectionsAgainstCamporee(dto.sections, {
        local_camporee_id: existing.local_camporee_id,
        union_camporee_id: existing.union_camporee_id,
      });
    }

    if (existing.scoring_enabled) {
      await this.assertMaxPointsMatchesActiveRubrics(eventId, maxPoints);
    }

    if (dto.status && dto.status !== existing.status) {
      this.enforceStatusTransition(existing.status, dto.status);
      if (dto.status === CamporeeEventStatusDto.publicado) {
        await this.ensureResponsibleAssignmentExists(eventId);
      }
    }

    const updated = await this.prisma.camporee_events.update({
      where: { camporee_event_id: eventId },
      data: {
        ...(dto.event_type_id ? { event_type_id: dto.event_type_id } : {}),
        ...(dto.title ? { title: dto.title } : {}),
        ...(typeof dto.description === 'string'
          ? { description: dto.description }
          : {}),
        ...(typeof dto.requirements === 'string'
          ? { requirements: dto.requirements }
          : {}),
        ...(typeof dto.development === 'string'
          ? { development: dto.development }
          : {}),
        ...(typeof dto.prerequisites === 'string'
          ? { prerequisites: dto.prerequisites }
          : {}),
        ...(typeof dto.materials === 'string'
          ? { materials: dto.materials }
          : {}),
        ...(typeof dto.auxiliaries === 'string'
          ? { auxiliaries: dto.auxiliaries }
          : {}),
        ...(dto.max_points !== undefined ? { max_points: dto.max_points } : {}),
        ...(dto.min_points !== undefined ? { min_points: dto.min_points } : {}),
        ...(dto.penalties !== undefined
          ? { penalties: dto.penalties as any }
          : {}),
        ...(dto.participants_mode
          ? { participants_mode: dto.participants_mode }
          : {}),
        ...(dto.participants_count !== undefined
          ? { participants_count: dto.participants_count }
          : {}),
        ...(dto.participants_by_class !== undefined
          ? { participants_by_class: dto.participants_by_class as any }
          : {}),
        ...(dto.duration_seconds !== undefined
          ? { duration_seconds: dto.duration_seconds }
          : {}),
        ...(typeof dto.active === 'boolean' ? { active: dto.active } : {}),
        // Agenda fields
        ...(dto.day_number !== undefined ? { day_number: dto.day_number } : {}),
        ...(dto.starts_at !== undefined ? { starts_at: dto.starts_at } : {}),
        ...(dto.ends_at !== undefined ? { ends_at: dto.ends_at } : {}),
        ...(dto.venue_id !== undefined ? { venue_id: dto.venue_id } : {}),
        ...(dto.leader_user_id !== undefined
          ? { leader_user_id: dto.leader_user_id }
          : {}),
        ...(dto.leader_name_override !== undefined
          ? { leader_name_override: dto.leader_name_override }
          : {}),
        ...(dto.leader_role !== undefined
          ? { leader_role: dto.leader_role }
          : {}),
        ...(dto.sections !== undefined ? { sections: dto.sections } : {}),
        ...(dto.display_category !== undefined
          ? { display_category: dto.display_category }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
        ...(dto.registered_count !== undefined
          ? { registered_count: dto.registered_count }
          : {}),
        modified_by: actorId,
        modified_at: new Date(),
      },
      include: {
        event_type: true,
        leader: {
          select: { user_id: true, name: true, paternal_last_name: true },
        },
        venue: { select: { camporee_venue_id: true, name: true } },
      },
    });

    this.logMutation('update', eventId, actorId);
    if (dto.honor_ids !== undefined) {
      await this.replaceEventHonors(eventId, dto.honor_ids);
    }
    if (dto.schedule_blocks !== undefined) {
      await this.replaceScheduleBlocks(
        eventId,
        { blocks: dto.schedule_blocks },
        actorId,
      );
      return this.getEvent(eventId);
    }
    const blocksByEvent = await this.loadScheduleBlocks([eventId]);
    const staffByEvent = await this.loadEventStaffAssignments([eventId]);
    const honorsByEvent = await this.loadEventHonors([eventId]);
    return this.attachEventHonors(
      this.attachEventStaffAssignments(
        this.attachScheduleBlocks([updated], blocksByEvent),
        staffByEvent,
      ),
      honorsByEvent,
    )[0];
  }

  private validateScheduleBlockTimes(block: {
    starts_at?: string | null;
    ends_at?: string | null;
  }) {
    if (block.starts_at && block.ends_at && block.starts_at >= block.ends_at) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_TEMPLATE_PARTICIPANTS_INVALID,
        {
          message:
            'Schedule block end time must be after schedule block start time.',
        },
      );
    }
  }

  private async resolveScheduleBlockAssignments(
    event: {
      local_camporee_id?: number | null;
      union_camporee_id?: number | null;
    },
    assignments: NonNullable<
      ReplaceCamporeeEventScheduleBlocksDto['blocks'][number]['assignments']
    >,
  ): Promise<ResolvedScheduleBlockAssignment[]> {
    const resolved: ResolvedScheduleBlockAssignment[] = [];

    for (const assignment of assignments) {
      const where: any = {
        active: true,
        club_section_id: assignment.club_section_id,
        ...(event.local_camporee_id
          ? { camporee_id: event.local_camporee_id }
          : { union_camporee_id: event.union_camporee_id }),
      };

      if (assignment.camporee_club_id) {
        where.camporee_club_id = assignment.camporee_club_id;
      }

      const camporeeClub = await this.prisma.camporee_clubs.findFirst({
        where,
        select: { camporee_club_id: true, club_section_id: true },
      });

      if (!camporeeClub) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_SCORING_SECTION_NOT_ENROLLED,
          { club_section_id: assignment.club_section_id },
        );
      }

      resolved.push({
        camporee_club_id: camporeeClub.camporee_club_id,
        club_section_id: camporeeClub.club_section_id!,
      });
    }

    return resolved;
  }

  async listEventStaffAssignments(eventId: number) {
    await this.ensureEventExists(eventId);
    const staffByEvent = await this.loadEventStaffAssignments([eventId]);
    return staffByEvent.get(eventId) ?? [];
  }

  async replaceEventStaffAssignments(
    eventId: number,
    dto: ReplaceCamporeeEventStaffAssignmentsDto,
    actorId: string,
  ) {
    const event = await this.ensureEventExists(eventId);
    const hasResponsible = dto.assignments.some(
      (assignment) => assignment.assignment_role === 'responsible',
    );

    if (event.status === CamporeeEventStatusDto.publicado && !hasResponsible) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_EVENT_RESPONSIBLE_REQUIRED,
      );
    }

    for (const assignment of dto.assignments) {
      await this.camporeeStaffService.assertStaffBelongsToEventCamporee(
        event,
        assignment.camporee_staff_member_id,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await (tx as any).camporee_event_staff_assignments.updateMany({
        where: { camporee_event_id: eventId, active: true },
        data: { active: false, modified_by: actorId, modified_at: new Date() },
      });

      for (const [index, assignment] of dto.assignments.entries()) {
        await (tx as any).camporee_event_staff_assignments.create({
          data: {
            camporee_event_id: eventId,
            camporee_staff_member_id: assignment.camporee_staff_member_id,
            assignment_role: assignment.assignment_role,
            title_override: assignment.title_override ?? null,
            notes: assignment.notes ?? null,
            display_order: assignment.display_order ?? index,
            created_by: actorId,
            modified_by: actorId,
          },
        });
      }
    });

    this.logMutation('replace_staff_assignments', eventId, actorId);
    return this.listEventStaffAssignments(eventId);
  }

  async replaceScheduleBlocks(
    eventId: number,
    dto: ReplaceCamporeeEventScheduleBlocksDto,
    actorId: string,
  ) {
    const event = await this.ensureEventExists(eventId);

    const blocksWithAssignments: ScheduleBlockWithAssignments[] = [];
    for (const [index, block] of dto.blocks.entries()) {
      this.validateScheduleBlockTimes(block);
      const assignments = block.assignments?.length
        ? await this.resolveScheduleBlockAssignments(event, block.assignments)
        : [];
      blocksWithAssignments.push({ block, assignments, index });
    }

    await this.prisma.$transaction(async (tx) => {
      await (tx as any).camporee_event_schedule_blocks.deleteMany({
        where: { camporee_event_id: eventId },
      });

      for (const { block, assignments, index } of blocksWithAssignments) {
        await (tx as any).camporee_event_schedule_blocks.create({
          data: {
            camporee_event_id: eventId,
            title: block.title ?? null,
            description: block.description ?? null,
            day_number: block.day_number,
            starts_at: block.starts_at ?? null,
            ends_at: block.ends_at ?? null,
            venue_id: block.venue_id ?? null,
            display_order: block.display_order ?? index,
            capacity: block.capacity ?? null,
            notes: block.notes ?? null,
            created_by: actorId,
            modified_by: actorId,
            assignments: assignments.length
              ? {
                  create: assignments.map((assignment) => ({
                    camporee_club_id: assignment.camporee_club_id,
                    club_section_id: assignment.club_section_id,
                    created_by: actorId,
                    modified_by: actorId,
                  })),
                }
              : undefined,
          },
        });
      }
    });

    this.logMutation('replace_schedule_blocks', eventId, actorId);
    return this.getEvent(eventId);
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
