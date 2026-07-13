import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { Prisma, role_category } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../common/services/authorization-context.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { CamporeeStaffService } from '../camporee-staff/camporee-staff.service';
import {
  AddCamporeeJudgeDto,
  AssignCamporeeEventJudgeDto,
  CamporeeEventJudgeAssignmentResponseDto,
  CamporeeEventRubricResponseDto,
  CamporeeEventSectionResultResponseDto,
  CamporeeEventScoreReceiptResponseDto,
  CamporeeJudgeCandidateResponseDto,
  CamporeeJudgeEligibilityReason,
  CamporeeJudgeResponseDto,
  CamporeeLeaderboardResponseDto,
  CamporeeScoreSource,
  CamporeeScopeType,
  ReplaceCamporeeEventRubricsDto,
  SubmitCamporeeEventScoreDto,
  UpdateCamporeeEventJudgeAssignmentDto,
} from './dto';

type CamporeeScope = { type: CamporeeScopeType; camporeeId: number };
type PrismaLike = Record<string, any>;

const CAMPOREE_JUDGE_CANDIDATE_LIMIT = 200;
const MASTER_GUIDES_CLUB_TYPE_ID = 3;

const camporeeJudgeCandidateUserSelect = Prisma.validator<Prisma.usersSelect>()(
  {
    user_id: true,
    email: true,
    name: true,
    paternal_last_name: true,
    maternal_last_name: true,
    user_image: true,
    active: true,
    access_app: true,
    access_panel: true,
    birthday: true,
    union_id: true,
    local_field_id: true,
    unions: {
      select: {
        union_id: true,
        name: true,
      },
    },
    local_fields: {
      select: {
        local_field_id: true,
        union_id: true,
        name: true,
      },
    },
    users_roles: {
      where: {
        active: true,
        roles: {
          active: true,
          role_category: role_category.GLOBAL,
        },
      },
      select: {
        roles: {
          select: {
            role_name: true,
          },
        },
      },
    },
    club_role_assignments: {
      where: {
        active: true,
        roles: {
          active: true,
          role_category: role_category.CLUB,
        },
      },
      select: {
        roles: {
          select: {
            role_name: true,
          },
        },
      },
    },
    enrollments: {
      where: {
        active: true,
        investiture_status: 'INVESTIDO',
      },
      select: {
        investiture_status: true,
        classes: {
          select: {
            name: true,
            club_type_id: true,
            club_types: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    },
  },
);

type CamporeeJudgeCandidateUserRecord = Prisma.usersGetPayload<{
  select: typeof camporeeJudgeCandidateUserSelect;
}>;

type CamporeeEventRecord = {
  camporee_event_id: number;
  local_camporee_id: number | null;
  union_camporee_id: number | null;
  max_points: number;
  min_points?: number | null;
  scoring_enabled?: boolean;
  active?: boolean;
  local_camporee?: {
    local_field_id: number;
    ecclesiastical_year?: number;
  } | null;
  union_camporee?: { union_id: number; ecclesiastical_year?: number } | null;
};

type RubricRecord = {
  camporee_event_rubric_id: number;
  camporee_event_id: number;
  title: string;
  description: string | null;
  max_points: unknown;
  display_order: number;
  active: boolean;
};

type EnrollmentRecord = {
  camporee_club_id: number;
  club_section_id: number | null;
  club_id?: number | null;
  status?: string | null;
};

type JudgeAssignmentRecord = {
  camporee_event_judge_assignment_id: string;
  camporee_event_id: number;
  camporee_judge_id: string;
  camporee_club_id: number | null;
  club_section_id: number;
  judge_role: 'primary' | 'assistant';
  active: boolean;
  camporee_judge?: {
    user_id: string;
    active: boolean;
    status: string;
  } | null;
};

@Injectable()
export class CamporeeScoringService {
  private readonly logger = new Logger(CamporeeScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly camporeeStaffService: CamporeeStaffService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  private db(tx?: PrismaLike): PrismaLike {
    return tx ?? this.prisma;
  }

  private toNumber(value: unknown): number {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') return Number(value);
    if (typeof (value as { toNumber?: () => number }).toNumber === 'function') {
      return (value as { toNumber: () => number }).toNumber();
    }
    return Number(value);
  }

  private round2(value: number): number {
    return Number(value.toFixed(2));
  }

  private normalizeText(value: string | null | undefined): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  private calculateAge(birthday: Date, referenceDate = new Date()): number {
    let age = referenceDate.getUTCFullYear() - birthday.getUTCFullYear();
    const monthDiff = referenceDate.getUTCMonth() - birthday.getUTCMonth();
    const dayDiff = referenceDate.getUTCDate() - birthday.getUTCDate();

    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      age -= 1;
    }

    return age;
  }

  private getAdultCutoffDate(referenceDate = new Date()): Date {
    const cutoff = new Date(referenceDate);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
    return cutoff;
  }

  private extractRoleNames(
    rows: Array<{ roles: { role_name: string } }>,
  ): string[] {
    return rows.map((row) => row.roles.role_name);
  }

  private buildJudgeEligibility(
    user: CamporeeJudgeCandidateUserRecord,
  ): CamporeeJudgeEligibilityReason[] {
    const roles = [
      ...this.extractRoleNames(user.users_roles),
      ...this.extractRoleNames(user.club_role_assignments),
    ].map((role) => this.normalizeText(role));
    const reasons: CamporeeJudgeEligibilityReason[] = [];

    if (user.birthday && this.calculateAge(user.birthday) >= 18) {
      reasons.push('adult');
    }

    if (roles.includes('pastor')) {
      reasons.push('pastor_role');
    }

    const hasInvestedMasterGuide = user.enrollments.some((enrollment) => {
      const className = this.normalizeText(enrollment.classes.name);
      const clubTypeName = this.normalizeText(
        enrollment.classes.club_types.name,
      );

      return (
        enrollment.investiture_status === 'INVESTIDO' &&
        (enrollment.classes.club_type_id === MASTER_GUIDES_CLUB_TYPE_ID ||
          clubTypeName === 'guias mayores' ||
          className.includes('guia mayor'))
      );
    });

    if (hasInvestedMasterGuide) {
      reasons.push('invested_master_guide');
    }

    return reasons;
  }

  private async resolvePrivateProfileUrl(
    value: string | null | undefined,
  ): Promise<string | null> {
    if (!value) return null;

    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        value,
        { expiresInSeconds: 300 },
      );
    } catch (error) {
      this.logger.warn(
        'Failed to generate signed URL for camporee judge candidate profile. Returning original value.',
        error,
      );
      return value;
    }
  }

  private async toJudgeCandidate(
    user: CamporeeJudgeCandidateUserRecord,
  ): Promise<CamporeeJudgeCandidateResponseDto> {
    const roles = [
      ...new Set([
        ...this.extractRoleNames(user.users_roles),
        ...this.extractRoleNames(user.club_role_assignments),
      ]),
    ].sort((a, b) => a.localeCompare(b));
    const eligibilityReasons = this.buildJudgeEligibility(user);

    return {
      user_id: user.user_id,
      email: user.email ?? null,
      name: user.name,
      paternal_last_name: user.paternal_last_name,
      maternal_last_name: user.maternal_last_name,
      full_name: [user.name, user.paternal_last_name, user.maternal_last_name]
        .filter(Boolean)
        .join(' ')
        .trim(),
      user_image: await this.resolvePrivateProfileUrl(user.user_image),
      active: user.active,
      access_app: user.access_app ?? false,
      access_panel: user.access_panel ?? false,
      union: user.unions
        ? {
            union_id: user.unions.union_id,
            name: user.unions.name,
          }
        : null,
      local_field: user.local_fields
        ? {
            local_field_id: user.local_fields.local_field_id,
            union_id: user.local_fields.union_id,
            name: user.local_fields.name,
          }
        : null,
      roles,
      camporee_judge_eligible: eligibilityReasons.length > 0,
      camporee_judge_eligibility_reasons: eligibilityReasons,
    };
  }

  private mapRubric(row: RubricRecord): CamporeeEventRubricResponseDto {
    return {
      camporee_event_rubric_id: row.camporee_event_rubric_id,
      camporee_event_id: row.camporee_event_id,
      title: row.title,
      description: row.description ?? null,
      max_points: this.toNumber(row.max_points),
      display_order: row.display_order,
      active: row.active,
    };
  }

  private mapAssignment(
    row: JudgeAssignmentRecord,
  ): CamporeeEventJudgeAssignmentResponseDto {
    return {
      camporee_event_judge_assignment_id:
        row.camporee_event_judge_assignment_id,
      camporee_event_id: row.camporee_event_id,
      camporee_judge_id: row.camporee_judge_id,
      camporee_club_id: row.camporee_club_id ?? null,
      club_section_id: row.club_section_id,
      judge_role: row.judge_role,
      active: row.active,
    };
  }

  private mapResult(row: any): CamporeeEventSectionResultResponseDto {
    return {
      camporee_event_section_result_id: row.camporee_event_section_result_id,
      camporee_event_id: row.camporee_event_id,
      camporee_club_id: row.camporee_club_id ?? null,
      club_section_id: row.club_section_id,
      source_submission_id: row.source_submission_id,
      score_status: row.score_status ?? 'scored',
      is_no_show: row.is_no_show ?? false,
      total_awarded_points: this.toNumber(row.total_awarded_points),
      total_max_points: this.toNumber(row.total_max_points),
      percentage: this.toNumber(row.percentage),
      active: row.active,
    };
  }

  private mapScoreReceipt(
    submission: any,
    result: any,
  ): CamporeeEventScoreReceiptResponseDto {
    if (!result) {
      throw new AppInternalServerErrorException(
        ErrorCode.CAMPOREE_SCORING_RECEIPT_INCOMPLETE,
      );
    }
    return {
      ...this.mapResult(result),
      active: true,
      camporee_event_score_submission_id:
        submission.camporee_event_score_submission_id,
      raw_awarded_points: this.toNumber(submission.raw_awarded_points),
      minimum_adjustment_points: this.toNumber(
        submission.minimum_adjustment_points,
      ),
      submitted_by: submission.submitted_by,
      submitted_at: submission.created_at,
      finalized_by: result.finalized_by,
      finalized_at: result.finalized_at,
      notes: submission.notes ?? null,
      items: (submission.items ?? []).map((item: any) => ({
        camporee_event_rubric_id: item.camporee_event_rubric_id,
        awarded_points: this.toNumber(item.awarded_points),
        notes: item.notes ?? null,
      })),
    };
  }

  private async findScoreSubmissionByIdempotencyKey(
    db: PrismaLike,
    actorUserId: string,
    idempotencyKey: string,
  ): Promise<any | null> {
    return db.camporee_event_score_submissions.findFirst({
      where: {
        submitted_by: actorUserId,
        idempotency_key: idempotencyKey,
      },
      include: {
        items: {
          orderBy: { camporee_event_rubric_id: 'asc' },
        },
        section_results: {
          orderBy: { created_at: 'asc' },
          take: 1,
        },
      },
    });
  }

  private mapIdempotentScoreReceipt(
    submission: any,
    requestHash: string,
  ): CamporeeEventScoreReceiptResponseDto {
    if (submission.request_hash !== requestHash) {
      throw new AppConflictException(ErrorCode.IDEMPOTENCY_KEY_REUSED);
    }
    return this.mapScoreReceipt(submission, submission.section_results?.[0]);
  }

  private isPrismaUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  private createScoreRequestHash(
    eventId: number,
    clubSectionId: number,
    dto: SubmitCamporeeEventScoreDto,
    source: CamporeeScoreSource,
    scoreStatus: 'scored' | 'no_show',
  ): string {
    const canonicalPayload = {
      target: { event_id: eventId, club_section_id: clubSectionId },
      source,
      score_status: scoreStatus,
      no_show: dto.no_show === true,
      notes: dto.notes?.normalize('NFC').trim() ?? null,
      expected_active_result_id:
        dto.expected_active_result_id?.toLowerCase() ?? null,
      items: (dto.items ?? [])
        .map((item) => ({
          camporee_event_rubric_id: item.camporee_event_rubric_id,
          awarded_points: this.round2(item.awarded_points),
          notes: item.notes?.normalize('NFC').trim() ?? null,
        }))
        .sort(
          (left, right) =>
            left.camporee_event_rubric_id - right.camporee_event_rubric_id,
        ),
    };

    return createHash('sha256')
      .update(JSON.stringify(canonicalPayload))
      .digest('hex');
  }

  private getEventScope(event: CamporeeEventRecord): CamporeeScope {
    if (event.local_camporee_id) {
      return { type: 'local', camporeeId: event.local_camporee_id };
    }
    if (event.union_camporee_id) {
      return { type: 'union', camporeeId: event.union_camporee_id };
    }
    throw new AppBadRequestException(
      ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
    );
  }

  private async resolveEvent(
    eventId: number,
    tx?: PrismaLike,
  ): Promise<CamporeeEventRecord> {
    const event = await this.db(tx).camporee_events.findUnique({
      where: { camporee_event_id: eventId },
      include: {
        local_camporee: {
          select: { local_field_id: true, ecclesiastical_year: true },
        },
        union_camporee: {
          select: { union_id: true, ecclesiastical_year: true },
        },
      },
    });

    if (!event) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_EVENT_NOT_FOUND, {
        id: eventId,
      });
    }

    return event;
  }

  private async ensureCamporeeExists(scope: CamporeeScope): Promise<void> {
    const exists =
      scope.type === 'local'
        ? await this.db().local_camporees.findUnique({
            where: { local_camporee_id: scope.camporeeId },
            select: { local_camporee_id: true },
          })
        : await this.db().union_camporees.findUnique({
            where: { union_camporee_id: scope.camporeeId },
            select: { union_camporee_id: true },
          });

    if (!exists) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
        {
          id: scope.camporeeId,
        },
      );
    }
  }

  private async resolveCamporeeUserScopeWhere(
    scope: CamporeeScope,
  ): Promise<Prisma.usersWhereInput> {
    if (scope.type === 'local') {
      const camporee = await this.db().local_camporees.findUnique({
        where: { local_camporee_id: scope.camporeeId },
        select: { local_field_id: true },
      });

      if (!camporee) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
          { id: scope.camporeeId },
        );
      }

      return { local_field_id: camporee.local_field_id };
    }

    const camporee = await this.db().union_camporees.findUnique({
      where: { union_camporee_id: scope.camporeeId },
      select: { union_id: true },
    });

    if (!camporee) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_EVENT_CAMPOREE_NOT_FOUND,
        {
          id: scope.camporeeId,
        },
      );
    }

    return { union_id: camporee.union_id };
  }

  private async ensureSectionEnrollment(
    event: CamporeeEventRecord,
    clubSectionId: number,
    tx?: PrismaLike,
  ): Promise<EnrollmentRecord> {
    const where = event.local_camporee_id
      ? { camporee_id: event.local_camporee_id }
      : { union_camporee_id: event.union_camporee_id };

    const enrollment = await this.db(tx).camporee_clubs.findFirst({
      where: {
        ...where,
        club_section_id: clubSectionId,
        active: true,
        status: { in: ['registered', 'approved'] },
      },
      select: {
        camporee_club_id: true,
        club_section_id: true,
        club_id: true,
        status: true,
      },
    });

    if (!enrollment) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_SCORING_SECTION_NOT_ENROLLED,
        { clubSectionId },
      );
    }

    return enrollment;
  }

  private async ensureClubRegistrationClosedForEvent(
    event: CamporeeEventRecord,
    tx?: PrismaLike,
  ): Promise<void> {
    const closedAt = event.local_camporee_id
      ? (
          await this.db(tx).local_camporees.findUnique({
            where: { local_camporee_id: event.local_camporee_id },
            select: { club_registration_closed_at: true },
          })
        )?.club_registration_closed_at
      : (
          await this.db(tx).union_camporees.findUnique({
            where: { union_camporee_id: event.union_camporee_id },
            select: { club_registration_closed_at: true },
          })
        )?.club_registration_closed_at;

    if (!closedAt) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_CLUB_REGISTRATION_NOT_CLOSED,
      );
    }
  }

  private async getActiveRubrics(
    eventId: number,
    tx?: PrismaLike,
  ): Promise<RubricRecord[]> {
    return this.db(tx).camporee_event_rubrics.findMany({
      where: { camporee_event_id: eventId, active: true },
      orderBy: [{ display_order: 'asc' }, { camporee_event_rubric_id: 'asc' }],
    });
  }

  private validateRubricTotal(
    event: CamporeeEventRecord,
    items: { max_points: number }[],
  ): void {
    const sum = this.round2(
      items.reduce((total, item) => total + Number(item.max_points), 0),
    );
    const maxPoints = this.round2(Number(event.max_points));
    if (sum !== maxPoints) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_SCORING_RUBRIC_SUM_MISMATCH,
        { sum, maxPoints },
      );
    }
  }

  private async findPrimaryAssignment(
    eventId: number,
    clubSectionId: number,
    actorUserId: string,
    tx?: PrismaLike,
  ): Promise<JudgeAssignmentRecord | null> {
    return this.db(tx).camporee_event_judge_assignments.findFirst({
      where: {
        camporee_event_id: eventId,
        club_section_id: clubSectionId,
        judge_role: 'primary',
        active: true,
        camporee_judge: {
          user_id: actorUserId,
          active: true,
          status: 'active',
        },
      },
      include: { camporee_judge: true },
    });
  }

  private async findAnyAssignmentForActor(
    eventId: number,
    clubSectionId: number,
    actorUserId: string,
    tx?: PrismaLike,
  ): Promise<JudgeAssignmentRecord | null> {
    return this.db(tx).camporee_event_judge_assignments.findFirst({
      where: {
        camporee_event_id: eventId,
        club_section_id: clubSectionId,
        active: true,
        camporee_judge: {
          user_id: actorUserId,
          active: true,
          status: 'active',
        },
      },
      include: { camporee_judge: true },
    });
  }

  private roleNames(resolved: ResolvedAuthorizationProfile): Set<string> {
    return new Set(
      resolved.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );
  }

  private hasPermission(
    resolved: ResolvedAuthorizationProfile,
    permission: string,
  ): boolean {
    return resolved.authorization.effective.permissions.includes(permission);
  }

  private canAccessEventScope(
    resolved: ResolvedAuthorizationProfile,
    event: CamporeeEventRecord,
  ): boolean {
    if (event.local_camporee_id) {
      return this.authorizationContext.canAccessHierarchyScope(
        resolved,
        {
          local_field_id: event.local_camporee?.local_field_id ?? null,
        },
        'current-write',
      );
    }

    return this.authorizationContext.canAccessHierarchyScope(
      resolved,
      {
        union_id: event.union_camporee?.union_id ?? null,
      },
      'current-write',
    );
  }

  private async canManageScoring(
    event: CamporeeEventRecord,
    actorUserId: string,
  ): Promise<boolean> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorUserId);
    return (
      this.hasPermission(resolved, 'camporee_events:update') &&
      this.canAccessEventScope(resolved, event)
    );
  }

  private async canReadScoring(
    event: CamporeeEventRecord,
    actorUserId: string,
  ): Promise<boolean> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorUserId);
    return (
      (this.hasPermission(resolved, 'camporee_events:read') ||
        this.hasPermission(resolved, 'camporee_events:update')) &&
      this.canAccessEventScope(resolved, event)
    );
  }

  private async resolveManualScoreSource(
    event: CamporeeEventRecord,
    actorUserId: string,
  ): Promise<'manual_lf' | 'admin_override' | null> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorUserId);
    const roles = this.roleNames(resolved);
    const hasTerritorialManagerRole =
      roles.has('assistant-lf') ||
      roles.has('director-lf') ||
      roles.has('assistant-union') ||
      roles.has('director-union');
    const hasGlobalAdminRole =
      roles.has('admin') ||
      roles.has('assistant-admin') ||
      roles.has('super-admin');

    if (
      (!hasTerritorialManagerRole && !hasGlobalAdminRole) ||
      !this.canAccessEventScope(resolved, event)
    ) {
      return null;
    }

    return hasGlobalAdminRole ? 'admin_override' : 'manual_lf';
  }

  async getEventRubrics(
    eventId: number,
    actorUserId: string,
  ): Promise<CamporeeEventRubricResponseDto[]> {
    const event = await this.resolveEvent(eventId);
    const canRead = await this.canReadScoring(event, actorUserId);
    const assignedJudge =
      await this.db().camporee_event_judge_assignments.findFirst({
        where: {
          camporee_event_id: eventId,
          active: true,
          camporee_judge: {
            user_id: actorUserId,
            active: true,
            status: 'active',
          },
        },
        select: { camporee_event_judge_assignment_id: true },
      });

    if (!canRead && !assignedJudge) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_SCORING_FORBIDDEN);
    }

    const rubrics = await this.getActiveRubrics(eventId);
    return rubrics.map((rubric) => this.mapRubric(rubric));
  }

  async replaceEventRubrics(
    eventId: number,
    dto: ReplaceCamporeeEventRubricsDto,
    actorUserId: string,
  ): Promise<CamporeeEventRubricResponseDto[]> {
    const event = await this.resolveEvent(eventId);
    await this.ensureClubRegistrationClosedForEvent(event);

    if (dto.scoring_enabled && dto.items.length === 0) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_SCORING_RUBRICS_REQUIRED,
      );
    }

    if (dto.scoring_enabled) {
      this.validateRubricTotal(event, dto.items);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const db = this.db(tx);
      await db.camporee_events.update({
        where: { camporee_event_id: eventId },
        data: {
          scoring_enabled: dto.scoring_enabled,
          modified_by: actorUserId,
        },
      });

      await db.camporee_event_rubrics.updateMany({
        where: { camporee_event_id: eventId, active: true },
        data: {
          active: false,
          modified_by: actorUserId,
          modified_at: new Date(),
        },
      });

      if (!dto.scoring_enabled) return [];

      const rows: RubricRecord[] = [];
      for (const [index, item] of dto.items.entries()) {
        rows.push(
          await db.camporee_event_rubrics.create({
            data: {
              camporee_event_id: eventId,
              title: item.title,
              description: item.description ?? null,
              max_points: item.max_points,
              display_order: item.display_order ?? index,
              created_by: actorUserId,
              modified_by: actorUserId,
            },
          }),
        );
      }
      return rows;
    });

    return created.map((rubric) => this.mapRubric(rubric));
  }

  async listCamporeeJudges(
    scope: CamporeeScope,
  ): Promise<CamporeeJudgeResponseDto[]> {
    await this.ensureCamporeeExists(scope);
    const rows = await this.db().camporee_judges.findMany({
      where:
        scope.type === 'local'
          ? { local_camporee_id: scope.camporeeId, active: true }
          : { union_camporee_id: scope.camporeeId, active: true },
      include: { user: true },
      orderBy: { created_at: 'asc' },
    });

    return rows.map((row: any) => ({
      camporee_judge_id: row.camporee_judge_id,
      user_id: row.user_id,
      name: row.user?.name ?? null,
      status: row.status,
      active: row.active,
    }));
  }

  async listCamporeeJudgeCandidates(
    scope: CamporeeScope,
  ): Promise<CamporeeJudgeCandidateResponseDto[]> {
    const camporeeUserWhere = await this.resolveCamporeeUserScopeWhere(scope);
    const adultCutoff = this.getAdultCutoffDate();

    const users = await this.db().users.findMany({
      where: {
        active: true,
        ...camporeeUserWhere,
        OR: [
          { birthday: { lte: adultCutoff } },
          {
            users_roles: {
              some: {
                active: true,
                roles: {
                  active: true,
                  role_category: role_category.GLOBAL,
                  role_name: { equals: 'pastor', mode: 'insensitive' },
                },
              },
            },
          },
          {
            enrollments: {
              some: {
                active: true,
                investiture_status: 'INVESTIDO',
              },
            },
          },
        ],
      },
      select: camporeeJudgeCandidateUserSelect,
      orderBy: [
        { name: 'asc' },
        { paternal_last_name: 'asc' },
        { email: 'asc' },
      ],
      take: CAMPOREE_JUDGE_CANDIDATE_LIMIT,
    });

    const candidates = await Promise.all(
      users.map((user: CamporeeJudgeCandidateUserRecord) =>
        this.toJudgeCandidate(user),
      ),
    );

    return candidates.filter((candidate) => candidate.camporee_judge_eligible);
  }

  async addJudgeToCamporee(
    scope: CamporeeScope,
    dto: AddCamporeeJudgeDto,
    actorUserId: string,
  ): Promise<CamporeeJudgeResponseDto> {
    const camporeeUserWhere = await this.resolveCamporeeUserScopeWhere(scope);

    const user = await this.db().users.findFirst({
      where: {
        user_id: dto.user_id,
        active: true,
        ...camporeeUserWhere,
      },
      select: camporeeJudgeCandidateUserSelect,
    });
    if (!user) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_USER_NOT_FOUND);
    }

    const eligibilityReasons = this.buildJudgeEligibility(user);
    if (eligibilityReasons.length === 0) {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_JUDGE_NOT_ELIGIBLE);
    }

    const where =
      scope.type === 'local'
        ? {
            local_camporee_id: scope.camporeeId,
            user_id: dto.user_id,
            active: true,
          }
        : {
            union_camporee_id: scope.camporeeId,
            user_id: dto.user_id,
            active: true,
          };

    const existing = await this.db().camporee_judges.findFirst({ where });
    if (existing) {
      await this.camporeeStaffService.ensureJudgeStaffMember(
        scope,
        dto.user_id,
        actorUserId,
      );
      return {
        camporee_judge_id: existing.camporee_judge_id,
        user_id: existing.user_id,
        name: user.name ?? null,
        status: existing.status,
        active: existing.active,
      };
    }

    const created = await this.db().camporee_judges.create({
      data: {
        ...(scope.type === 'local'
          ? { local_camporee_id: scope.camporeeId }
          : { union_camporee_id: scope.camporeeId }),
        user_id: dto.user_id,
        notes: dto.notes ?? null,
        created_by: actorUserId,
        modified_by: actorUserId,
      },
    });

    await this.camporeeStaffService.ensureJudgeStaffMember(
      scope,
      dto.user_id,
      actorUserId,
    );

    return {
      camporee_judge_id: created.camporee_judge_id,
      user_id: created.user_id,
      name: user.name ?? null,
      status: created.status,
      active: created.active,
    };
  }

  async listEventJudgeAssignments(
    eventId: number,
  ): Promise<CamporeeEventJudgeAssignmentResponseDto[]> {
    await this.resolveEvent(eventId);
    const rows = await this.db().camporee_event_judge_assignments.findMany({
      where: { camporee_event_id: eventId, active: true },
      orderBy: [{ club_section_id: 'asc' }, { judge_role: 'desc' }],
    });
    return rows.map((row: JudgeAssignmentRecord) => this.mapAssignment(row));
  }

  async assignJudgeToSection(
    eventId: number,
    dto: AssignCamporeeEventJudgeDto,
    actorUserId: string,
  ): Promise<CamporeeEventJudgeAssignmentResponseDto> {
    const event = await this.resolveEvent(eventId);
    await this.ensureClubRegistrationClosedForEvent(event);
    const enrollment = await this.ensureSectionEnrollment(
      event,
      dto.club_section_id,
    );

    const judge = await this.db().camporee_judges.findUnique({
      where: { camporee_judge_id: dto.camporee_judge_id },
    });
    if (!judge || !judge.active || judge.status !== 'active') {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_SCORING_JUDGE_NOT_FOUND,
      );
    }

    const sameScope = event.local_camporee_id
      ? judge.local_camporee_id === event.local_camporee_id
      : judge.union_camporee_id === event.union_camporee_id;
    if (!sameScope) {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_EVENT_ACCESS_DENIED);
    }

    await this.camporeeStaffService.ensureJudgeStaffMember(
      this.getEventScope(event),
      judge.user_id,
      actorUserId,
    );

    if (dto.judge_role === 'primary') {
      const existingPrimary =
        await this.db().camporee_event_judge_assignments.findFirst({
          where: {
            camporee_event_id: eventId,
            club_section_id: dto.club_section_id,
            judge_role: 'primary',
            active: true,
          },
        });
      if (existingPrimary) {
        throw new AppConflictException(
          ErrorCode.CAMPOREE_SCORING_PRIMARY_JUDGE_CONFLICT,
        );
      }
    }

    const created = await this.db().camporee_event_judge_assignments.create({
      data: {
        camporee_event_id: eventId,
        camporee_judge_id: dto.camporee_judge_id,
        camporee_club_id: dto.camporee_club_id ?? enrollment.camporee_club_id,
        club_section_id: dto.club_section_id,
        judge_role: dto.judge_role,
        created_by: actorUserId,
        modified_by: actorUserId,
      },
    });

    return this.mapAssignment(created);
  }

  async updateJudgeAssignment(
    assignmentId: string,
    dto: UpdateCamporeeEventJudgeAssignmentDto,
    actorUserId: string,
  ): Promise<CamporeeEventJudgeAssignmentResponseDto> {
    const assignment =
      await this.db().camporee_event_judge_assignments.findUnique({
        where: { camporee_event_judge_assignment_id: assignmentId },
      });
    if (!assignment) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_SCORING_JUDGE_NOT_FOUND,
      );
    }

    const event = await this.resolveEvent(assignment.camporee_event_id);
    await this.ensureClubRegistrationClosedForEvent(event);
    if (!(await this.canManageScoring(event, actorUserId))) {
      throw new AppForbiddenException(ErrorCode.CAMPOREE_SCORING_FORBIDDEN);
    }

    if (dto.judge_role === 'primary') {
      const existingPrimary =
        await this.db().camporee_event_judge_assignments.findFirst({
          where: {
            camporee_event_id: assignment.camporee_event_id,
            club_section_id: assignment.club_section_id,
            judge_role: 'primary',
            active: true,
            NOT: { camporee_event_judge_assignment_id: assignmentId },
          },
        });
      if (existingPrimary) {
        throw new AppConflictException(
          ErrorCode.CAMPOREE_SCORING_PRIMARY_JUDGE_CONFLICT,
        );
      }
    }

    const updated = await this.db().camporee_event_judge_assignments.update({
      where: { camporee_event_judge_assignment_id: assignmentId },
      data: {
        ...(dto.judge_role ? { judge_role: dto.judge_role } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        modified_by: actorUserId,
        modified_at: new Date(),
      },
    });

    return this.mapAssignment(updated);
  }

  async deactivateJudgeAssignment(
    assignmentId: string,
    actorUserId: string,
  ): Promise<CamporeeEventJudgeAssignmentResponseDto> {
    return this.updateJudgeAssignment(
      assignmentId,
      { active: false },
      actorUserId,
    );
  }

  private validateScoreItems(
    rubrics: RubricRecord[],
    dto: SubmitCamporeeEventScoreDto,
  ): void {
    if (rubrics.length === 0) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_SCORING_RUBRICS_REQUIRED,
      );
    }

    const rubricById = new Map(
      rubrics.map((rubric) => [rubric.camporee_event_rubric_id, rubric]),
    );
    const submittedIds = new Set(
      dto.items.map((item) => item.camporee_event_rubric_id),
    );

    if (
      submittedIds.size !== rubrics.length ||
      dto.items.length !== rubrics.length
    ) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_SCORING_RUBRIC_ITEM_MISMATCH,
      );
    }

    for (const item of dto.items) {
      const rubric = rubricById.get(item.camporee_event_rubric_id);
      if (!rubric) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_SCORING_RUBRIC_ITEM_MISMATCH,
        );
      }
      const maxPoints = this.toNumber(rubric.max_points);
      if (item.awarded_points > maxPoints) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_SCORING_POINTS_EXCEED_MAX,
          { awardedPoints: item.awarded_points, maxPoints },
        );
      }
    }
  }

  private ensureRubricsExist(rubrics: RubricRecord[]): void {
    if (rubrics.length === 0) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_SCORING_RUBRICS_REQUIRED,
      );
    }
  }

  async submitScore(
    eventId: number,
    clubSectionId: number,
    dto: SubmitCamporeeEventScoreDto,
    actorUserId: string,
    idempotencyKey?: string,
  ): Promise<CamporeeEventScoreReceiptResponseDto> {
    const event = await this.resolveEvent(eventId);
    await this.ensureClubRegistrationClosedForEvent(event);
    if (!event.scoring_enabled) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_SCORING_EVENT_NOT_SCORABLE,
      );
    }

    const enrollment = await this.ensureSectionEnrollment(event, clubSectionId);
    const rubrics = await this.getActiveRubrics(eventId);
    const isNoShow = dto.no_show === true;
    const submittedItems = dto.items ?? [];
    if (isNoShow) {
      this.ensureRubricsExist(rubrics);
      if (submittedItems.length > 0) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_SCORING_RUBRIC_ITEM_MISMATCH,
        );
      }
    } else {
      this.validateScoreItems(rubrics, { ...dto, items: submittedItems });
    }

    const primaryAssignment = await this.findPrimaryAssignment(
      eventId,
      clubSectionId,
      actorUserId,
    );
    const manualScoreSource = await this.resolveManualScoreSource(
      event,
      actorUserId,
    );

    const overrideRequested =
      dto.source === 'manual_lf' || dto.source === 'admin_override';
    let source: CamporeeScoreSource;
    let judgeAssignmentId: string | null = null;

    if (primaryAssignment && !overrideRequested) {
      source = 'judge_primary';
      judgeAssignmentId = primaryAssignment.camporee_event_judge_assignment_id;
    } else if (manualScoreSource) {
      source = manualScoreSource;
    } else {
      const anyAssignment = await this.findAnyAssignmentForActor(
        eventId,
        clubSectionId,
        actorUserId,
      );
      if (anyAssignment?.judge_role === 'assistant') {
        throw new AppForbiddenException(ErrorCode.CAMPOREE_SCORING_FORBIDDEN);
      }
      throw new AppForbiddenException(ErrorCode.CAMPOREE_SCORING_FORBIDDEN);
    }

    const rubricById = new Map(
      rubrics.map((rubric) => [rubric.camporee_event_rubric_id, rubric]),
    );
    const rawAwarded = this.round2(
      isNoShow
        ? 0
        : submittedItems.reduce(
            (total, item) => total + item.awarded_points,
            0,
          ),
    );
    const totalMax = this.round2(
      rubrics.reduce(
        (total, rubric) => total + this.toNumber(rubric.max_points),
        0,
      ),
    );
    const minPoints = this.round2(this.toNumber(event.min_points ?? 0));
    const totalAwarded = this.round2(
      isNoShow
        ? minPoints
        : minPoints > 0 && rawAwarded < minPoints
          ? minPoints
          : rawAwarded,
    );
    if (totalAwarded > totalMax) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_SCORING_POINTS_EXCEED_MAX,
        { awardedPoints: totalAwarded, maxPoints: totalMax },
      );
    }
    const percentage =
      totalMax === 0 ? 0 : this.round2((totalAwarded / totalMax) * 100);
    const scoreStatus = isNoShow ? 'no_show' : 'scored';
    const requestHash = this.createScoreRequestHash(
      eventId,
      clubSectionId,
      { ...dto, items: submittedItems },
      source,
      scoreStatus,
    );
    const normalizedIdempotencyKey = idempotencyKey?.toLowerCase();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const db = this.db(tx);
        if (normalizedIdempotencyKey) {
          const idempotencyLockIdentity = `camporee-score-idempotency:${actorUserId}:${normalizedIdempotencyKey}`;
          await db.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockIdentity}, 0))`,
          );
        }
        await db.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(${eventId}::integer, ${clubSectionId}::integer)`,
        );

        if (normalizedIdempotencyKey) {
          const existingSubmission =
            await this.findScoreSubmissionByIdempotencyKey(
              db,
              actorUserId,
              normalizedIdempotencyKey,
            );
          if (existingSubmission) {
            return this.mapIdempotentScoreReceipt(
              existingSubmission,
              requestHash,
            );
          }
        }

        const activeResult = await db.camporee_event_section_results.findFirst({
          where: {
            camporee_event_id: eventId,
            club_section_id: clubSectionId,
            active: true,
          },
          select: {
            camporee_event_section_result_id: true,
            source_submission_id: true,
          },
        });
        const isManualSource =
          source === 'manual_lf' || source === 'admin_override';

        if (activeResult && !isManualSource) {
          throw new AppConflictException(
            ErrorCode.CAMPOREE_SCORING_RESULT_ALREADY_SUBMITTED,
          );
        }
        if (
          isManualSource &&
          (!activeResult
            ? dto.expected_active_result_id !== undefined
            : dto.expected_active_result_id !==
              activeResult.camporee_event_section_result_id)
        ) {
          throw new AppConflictException(
            ErrorCode.CAMPOREE_SCORING_RESULT_STALE,
          );
        }
        if (activeResult && isManualSource && !dto.notes?.trim()) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_SCORING_OVERRIDE_REASON_REQUIRED,
          );
        }

        const submission = await db.camporee_event_score_submissions.create({
          data: {
            camporee_event_id: eventId,
            camporee_club_id: enrollment.camporee_club_id,
            club_section_id: clubSectionId,
            judge_assignment_id: judgeAssignmentId,
            submitted_by: actorUserId,
            source,
            idempotency_key: normalizedIdempotencyKey ?? null,
            request_hash: normalizedIdempotencyKey ? requestHash : null,
            score_status: scoreStatus,
            is_no_show: isNoShow,
            override_of_submission_id:
              activeResult && isManualSource
                ? activeResult.source_submission_id
                : null,
            total_awarded_points: totalAwarded,
            raw_awarded_points: rawAwarded,
            minimum_adjustment_points: this.round2(totalAwarded - rawAwarded),
            total_max_points: totalMax,
            notes: dto.notes ?? null,
          },
        });

        for (const item of submittedItems) {
          const rubric = rubricById.get(item.camporee_event_rubric_id);
          await db.camporee_event_score_submission_items.create({
            data: {
              camporee_event_score_submission_id:
                submission.camporee_event_score_submission_id,
              camporee_event_rubric_id: item.camporee_event_rubric_id,
              awarded_points: item.awarded_points,
              notes: item.notes ?? null,
            },
          });
          void rubric;
        }

        await db.camporee_event_section_results.updateMany({
          where: {
            camporee_event_id: eventId,
            club_section_id: clubSectionId,
            active: true,
          },
          data: { active: false, modified_at: new Date() },
        });

        const createdResult = await db.camporee_event_section_results.create({
          data: {
            camporee_event_id: eventId,
            camporee_club_id: enrollment.camporee_club_id,
            club_section_id: clubSectionId,
            source_submission_id: submission.camporee_event_score_submission_id,
            score_status: scoreStatus,
            is_no_show: isNoShow,
            total_awarded_points: totalAwarded,
            total_max_points: totalMax,
            percentage,
            finalized_by: actorUserId,
          },
        });
        return this.mapScoreReceipt(
          {
            ...submission,
            raw_awarded_points: rawAwarded,
            minimum_adjustment_points: this.round2(totalAwarded - rawAwarded),
            total_awarded_points: totalAwarded,
            total_max_points: totalMax,
            notes: dto.notes ?? null,
            submitted_by: actorUserId,
            items: submittedItems,
          },
          createdResult,
        );
      });
    } catch (error) {
      if (
        !normalizedIdempotencyKey ||
        !this.isPrismaUniqueConstraintError(error)
      ) {
        throw error;
      }

      const existingSubmission = await this.findScoreSubmissionByIdempotencyKey(
        this.db(),
        actorUserId,
        normalizedIdempotencyKey,
      );
      if (!existingSubmission) {
        throw error;
      }
      return this.mapIdempotentScoreReceipt(existingSubmission, requestHash);
    }
  }

  async getScoringTargets(eventId: number, actorUserId: string) {
    const event = await this.resolveEvent(eventId);
    const canRead = await this.canReadScoring(event, actorUserId);
    const scopeWhere = event.local_camporee_id
      ? { camporee_id: event.local_camporee_id }
      : { union_camporee_id: event.union_camporee_id };

    if (!canRead) {
      const assigned =
        await this.db().camporee_event_judge_assignments.findFirst({
          where: {
            camporee_event_id: eventId,
            active: true,
            camporee_judge: {
              user_id: actorUserId,
              active: true,
              status: 'active',
            },
          },
        });
      if (!assigned) {
        throw new AppForbiddenException(ErrorCode.CAMPOREE_SCORING_FORBIDDEN);
      }
    }

    const rows = await this.db().camporee_clubs.findMany({
      where: {
        ...scopeWhere,
        active: true,
        status: { in: ['registered', 'approved'] },
        club_section_id: { not: null },
      },
      include: { club_sections: { include: { clubs: true } } },
      orderBy: { camporee_club_id: 'asc' },
    });

    return rows.map((row: any) => ({
      camporee_club_id: row.camporee_club_id,
      club_section_id: row.club_section_id,
      club_name: row.club_sections?.clubs?.name ?? null,
      section_name: row.club_sections?.name ?? null,
      status: row.status,
    }));
  }

  async getCamporeeLeaderboard(
    scope: CamporeeScope,
  ): Promise<CamporeeLeaderboardResponseDto> {
    await this.ensureCamporeeExists(scope);

    const rows =
      scope.type === 'local'
        ? await this.prisma.$queryRaw<any[]>`
            SELECT
              r.camporee_club_id,
              r.club_section_id,
              c.name AS club_name,
              cs.name AS section_name,
              SUM(r.total_awarded_points)::numeric(10,2) AS total_awarded_points,
              SUM(r.total_max_points)::numeric(10,2) AS total_max_points,
              CASE WHEN SUM(r.total_max_points) = 0 THEN 0
                   ELSE ROUND((SUM(r.total_awarded_points) / SUM(r.total_max_points)) * 100, 2)
              END AS percentage
            FROM camporee_event_section_results r
            JOIN camporee_events e ON e.camporee_event_id = r.camporee_event_id
            LEFT JOIN camporee_clubs cc ON cc.camporee_club_id = r.camporee_club_id
            LEFT JOIN club_sections cs ON cs.club_section_id = r.club_section_id
            LEFT JOIN clubs c ON c.club_id = cs.main_club_id
            WHERE r.active = TRUE
              AND e.active = TRUE
              AND e.scoring_enabled = TRUE
              AND e.local_camporee_id = ${scope.camporeeId}
            GROUP BY r.camporee_club_id, r.club_section_id, c.name, cs.name
            ORDER BY percentage DESC, total_awarded_points DESC, section_name ASC
          `
        : await this.prisma.$queryRaw<any[]>`
            SELECT
              r.camporee_club_id,
              r.club_section_id,
              c.name AS club_name,
              cs.name AS section_name,
              SUM(r.total_awarded_points)::numeric(10,2) AS total_awarded_points,
              SUM(r.total_max_points)::numeric(10,2) AS total_max_points,
              CASE WHEN SUM(r.total_max_points) = 0 THEN 0
                   ELSE ROUND((SUM(r.total_awarded_points) / SUM(r.total_max_points)) * 100, 2)
              END AS percentage
            FROM camporee_event_section_results r
            JOIN camporee_events e ON e.camporee_event_id = r.camporee_event_id
            LEFT JOIN camporee_clubs cc ON cc.camporee_club_id = r.camporee_club_id
            LEFT JOIN club_sections cs ON cs.club_section_id = r.club_section_id
            LEFT JOIN clubs c ON c.club_id = cs.main_club_id
            WHERE r.active = TRUE
              AND e.active = TRUE
              AND e.scoring_enabled = TRUE
              AND e.union_camporee_id = ${scope.camporeeId}
            GROUP BY r.camporee_club_id, r.club_section_id, c.name, cs.name
            ORDER BY percentage DESC, total_awarded_points DESC, section_name ASC
          `;

    return {
      scope,
      rows: rows.map((row, index) => ({
        rank: index + 1,
        camporee_club_id: row.camporee_club_id ?? null,
        club_section_id: Number(row.club_section_id),
        club_name: row.club_name ?? null,
        section_name: row.section_name ?? null,
        total_awarded_points: this.toNumber(row.total_awarded_points),
        total_max_points: this.toNumber(row.total_max_points),
        percentage: this.toNumber(row.percentage),
      })),
    };
  }

  async getMyJudgeAssignments(actorUserId: string) {
    const rows = await this.db().camporee_event_judge_assignments.findMany({
      where: {
        active: true,
        camporee_judge: {
          user_id: actorUserId,
          active: true,
          status: 'active',
        },
        camporee_event: { active: true, scoring_enabled: true },
      },
      include: {
        camporee_event: true,
        camporee_judge: true,
      },
      orderBy: [{ created_at: 'desc' }],
    });

    return rows.map((row: any) => ({
      ...this.mapAssignment(row),
      event_title: row.camporee_event?.title ?? null,
      can_submit_score: row.judge_role === 'primary',
    }));
  }
}
