import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ageToday } from '../common/age/age.util';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import {
  ECCLESIASTICAL_YEAR_TIMEZONE,
  EcclesiasticalYearService,
  ecclesiasticalYearName,
} from '../common/services/ecclesiastical-year.service';
import { escapeLikeWildcards } from '../common/utils/escape-like';
import {
  ClubRoleEligibilityService,
  type GuideMajorEligibility,
} from '../club-role-eligibility/club-role-eligibility.service';
import { VISIBLE_DEPENDENT } from '../guardianships/guardianship-queries';
import { ConsentGateService } from '../membership-requests/consent-gate.service';
import { displayName } from '../investiture-requests/investiture-communications.rules';
import { PrismaService } from '../prisma/prisma.service';
import { RoleRequirementService } from '../role-requirements/role-requirement.service';
import {
  GM_BASE_STATUSES,
  GM_ENROLLED_STATUSES,
  findClubGmSectionId,
  findClubNonMemberAssignments,
  findGmMemberRows,
  findSectionServiceHolders,
  type NonMemberAssignmentRow,
} from './club-role-candidates.queries';
import {
  EXCLUSIVE_WITH,
  SERVICE_ROLE_NAMES,
  effectiveMaxPerSection,
  evaluateServiceRoleAllowance,
  isServiceRoleName,
} from './club-role-rules';
import type { RoleCandidatesQueryDto } from './dto/role-candidates-query.dto';
import { clubTypeSectionKind } from './section-display';

const PHOTO_URL_TTL_SECONDS = 600;
const GM_ADVANCED_ASSET_CODE = 'GM-02';
const GM_INSTRUCTOR_ASSET_CODE = 'GM-03';

type Group = 'available' | 'with_role' | 'not_enrolled';
type GmAnnualStatus = 'active' | 'pending' | 'inactive' | 'none';

type SectionContext = {
  clubId: number;
  sectionId: number;
  clubTypeId: number | null;
  clubTypeName: string;
  year: { year_id: number; start_date: Date; end_date: Date };
  previousYearId: number | null;
  gmSectionId: number | null;
};

type BaseCandidate = {
  user: {
    user_id: string;
    name: string | null;
    paternal_last_name: string | null;
    maternal_last_name: string | null;
    user_image: string | null;
    birthday: Date | null;
    gender: string | null;
  };
  displayName: string;
  group: Group;
  gmAnnualStatus: GmAnnualStatus;
  eligibility: GuideMajorEligibility;
  currentRoles: NonMemberAssignmentRow[];
  holdsRoleInTargetSection: boolean;
  serviceYears: number;
  history: NonMemberAssignmentRow[];
};

const GM_STATUS_RANK: Record<GmAnnualStatus, number> = {
  active: 3,
  pending: 2,
  inactive: 1,
  none: 0,
};

@Injectable()
export class ClubRoleCandidatesService {
  private readonly logger = new Logger(ClubRoleCandidatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ecclesiasticalYear: EcclesiasticalYearService,
    private readonly roleEligibility: ClubRoleEligibilityService,
    private readonly consentGate: ConsentGateService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly roleRequirements: RoleRequirementService,
  ) {}

  // ----------------------------------------------------------------------
  // GET /clubs/:clubId/sections/:sectionId/role-candidates
  // ----------------------------------------------------------------------

  async list(
    clubId: number,
    sectionId: number,
    callerUserId: string,
    query: RoleCandidatesQueryDto,
  ) {
    const context = await this.resolveContext(clubId, sectionId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = query.filter ?? 'all';

    const [slotData, candidates] = await Promise.all([
      this.loadSlotData(context),
      this.loadCandidates(context, { search: query.search }),
    ]);

    const counts = { available: 0, with_role: 0, not_enrolled: 0 };
    for (const candidate of candidates) counts[candidate.group] += 1;

    const filtered =
      filter === 'all'
        ? candidates
        : candidates.filter((candidate) => candidate.group === filter);
    const pageRows = filtered.slice((page - 1) * limit, page * limit);
    const items = await this.buildItems(
      context,
      slotData,
      pageRows,
      callerUserId,
    );

    return {
      section: this.sectionBlock(context),
      slots: slotData.slots,
      items,
      meta: { page, limit, total: filtered.length, counts },
    };
  }

  // ----------------------------------------------------------------------
  // GET /clubs/:clubId/sections/:sectionId/role-candidates/:userId
  // ----------------------------------------------------------------------

  async detail(
    clubId: number,
    sectionId: number,
    userId: string,
    callerUserId: string,
  ) {
    const context = await this.resolveContext(clubId, sectionId);
    const [slotData, candidates] = await Promise.all([
      this.loadSlotData(context),
      this.loadCandidates(context, { userId }),
    ]);
    // Anti-probe: the same 404 for "not a candidate" and "does not exist".
    const candidate = candidates[0];
    if (!candidate) {
      throw new AppNotFoundException(ErrorCode.GUARD_ASSIGNMENT_NOT_FOUND);
    }

    const [items, certifications, insurance, honorsCount, credentials] =
      await Promise.all([
        this.buildItems(context, slotData, [candidate], callerUserId),
        this.prisma.users_certifications.findMany({
          where: { user_id: userId, active: true },
          select: {
            status: true,
            certified_at: true,
            certifications: { select: { name: true } },
          },
          orderBy: { enrollment_date: 'desc' },
        }),
        this.loadInsurance(userId),
        this.prisma.users_honors.count({
          where: {
            user_id: userId,
            active: true,
            validation_status: 'APPROVED',
          },
        }),
        // Never the object key or a file URL: only the review state.
        this.prisma.service_credentials.findMany({
          where: { user_id: userId, active: true },
          select: {
            credential_type: true,
            status: true,
            completed_at: true,
            expires_at: true,
          },
          orderBy: { created_at: 'desc' },
        }),
      ]);

    const roleHistory = [...candidate.history]
      .sort(
        (a, b) =>
          b.ecclesiastical_year.start_date.getTime() -
          a.ecclesiastical_year.start_date.getTime(),
      )
      .map((row) => ({
        year_name: ecclesiasticalYearName(row.ecclesiastical_year),
        club_type_name: row.club_sections?.club_types?.name ?? null,
        role: row.roles.role_name,
      }));

    return {
      ...items[0],
      role_history: roleHistory,
      certifications: certifications.map((row) => ({
        name: row.certifications.name,
        status: row.status,
        certified_at: row.certified_at?.toISOString() ?? null,
      })),
      insurance,
      honors_count: honorsCount,
      credentials: credentials.map((row) => ({
        type: row.credential_type,
        status: row.status,
        completed_at: row.completed_at?.toISOString().slice(0, 10) ?? null,
        expires_at: row.expires_at?.toISOString().slice(0, 10) ?? null,
      })),
    };
  }

  // ----------------------------------------------------------------------
  // Context and slots
  // ----------------------------------------------------------------------

  private async resolveContext(
    clubId: number,
    sectionId: number,
  ): Promise<SectionContext> {
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: {
        main_club_id: true,
        club_type_id: true,
        club_types: { select: { name: true } },
      },
    });
    if (!section || section.main_club_id !== clubId) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }
    const kind = clubTypeSectionKind(section.club_types?.name);
    if (kind !== 'AV' && kind !== 'CQ') {
      throw new AppConflictException(
        ErrorCode.CLUB_ROLE_CANDIDATES_SECTION_NOT_SERVICE,
      );
    }

    let year;
    try {
      year = await this.ecclesiasticalYear.getCurrentYear();
    } catch (err) {
      if (
        err instanceof AppNotFoundException &&
        err.code === ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND
      ) {
        throw new AppBadRequestException(ErrorCode.CLUB_NO_ACTIVE_YEAR);
      }
      throw err;
    }
    const [previousYear, gmSectionId] = await Promise.all([
      this.prisma.ecclesiastical_years.findFirst({
        where: { end_date: { lt: year.start_date } },
        orderBy: { end_date: 'desc' },
        select: { year_id: true },
      }),
      findClubGmSectionId(this.prisma, clubId),
    ]);

    return {
      clubId,
      sectionId,
      clubTypeId: section.club_type_id ?? null,
      clubTypeName: section.club_types?.name ?? '',
      year,
      previousYearId: previousYear?.year_id ?? null,
      gmSectionId,
    };
  }

  private sectionBlock(context: SectionContext) {
    return {
      id: context.sectionId,
      club_type_id: context.clubTypeId,
      club_type_name: context.clubTypeName,
      // false = the club has no Guías Mayores section, so the list is empty.
      has_gm_section: context.gmSectionId !== null,
      year: {
        id: context.year.year_id,
        name: ecclesiasticalYearName(context.year),
      },
    };
  }

  private async loadSlotData(context: SectionContext) {
    const [roles, holders] = await Promise.all([
      this.prisma.roles.findMany({
        where: {
          role_name: { in: [...SERVICE_ROLE_NAMES] },
          role_category: 'CLUB',
          active: true,
        },
        select: {
          role_id: true,
          role_name: true,
          role_slot_limits: { select: { max_per_section: true } },
        },
      }),
      findSectionServiceHolders(this.prisma, {
        sectionId: context.sectionId,
        yearId: context.year.year_id,
      }),
    ]);

    const maxByRole = new Map<string, number | null>();
    for (const roleName of SERVICE_ROLE_NAMES) {
      const row = roles.find((role) => role.role_name === roleName);
      const configured = row?.role_slot_limits?.max_per_section ?? null;
      maxByRole.set(roleName, effectiveMaxPerSection(roleName, configured));
    }
    const occupiedByRole = new Map<string, number>();
    const holderNames = new Map<string, string[]>();
    for (const holder of holders) {
      const role = holder.roles.role_name;
      occupiedByRole.set(role, (occupiedByRole.get(role) ?? 0) + 1);
      const names = holderNames.get(role) ?? [];
      names.push(
        [holder.users?.name, holder.users?.paternal_last_name]
          .filter(Boolean)
          .join(' '),
      );
      holderNames.set(role, names);
    }

    const slots = SERVICE_ROLE_NAMES.map((role) => ({
      role,
      occupied: occupiedByRole.get(role) ?? 0,
      max: maxByRole.get(role) ?? null,
      holders: holderNames.get(role) ?? [],
      blocked_by: (EXCLUSIVE_WITH[role] ?? []).filter(
        (other) => (occupiedByRole.get(other) ?? 0) > 0,
      ),
    }));

    return { slots, occupiedByRole, maxByRole };
  }

  // ----------------------------------------------------------------------
  // Candidates
  // ----------------------------------------------------------------------

  /**
   * Base set: eligible Guias Mayores with a `member` row in the club's GM
   * section in the current or previous year, without hidden dependents.
   * Everything is batched by `user_id IN (...)`.
   */
  private async loadCandidates(
    context: SectionContext,
    filter: { search?: string; userId?: string },
  ): Promise<BaseCandidate[]> {
    if (context.gmSectionId === null) return [];

    const tokens = (filter.search ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeLikeWildcards);
    const userWhere: Prisma.usersWhereInput = {
      AND: [
        { OR: [{ dependent_profile: { is: null } }, VISIBLE_DEPENDENT] },
        ...(filter.userId ? [{ user_id: filter.userId }] : []),
        ...tokens.map((token): Prisma.usersWhereInput => ({
          OR: [
            { name: { contains: token, mode: 'insensitive' } },
            { paternal_last_name: { contains: token, mode: 'insensitive' } },
            { maternal_last_name: { contains: token, mode: 'insensitive' } },
          ],
        })),
      ],
    };
    const yearIds = [context.year.year_id];
    if (context.previousYearId !== null) yearIds.push(context.previousYearId);

    const gmRows = await findGmMemberRows(this.prisma, {
      gmSectionId: context.gmSectionId,
      yearIds,
      statuses: GM_BASE_STATUSES,
      userWhere,
    });
    const baseIds = [...new Set(gmRows.map((row) => row.user_id))];
    if (baseIds.length === 0) return [];

    const eligibility = await this.roleEligibility.evaluateMany(baseIds);
    const eligibleIds = baseIds.filter(
      (id) => eligibility.get(id)?.eligible === true,
    );
    if (eligibleIds.length === 0) return [];

    const [users, assignments] = await Promise.all([
      this.prisma.users.findMany({
        where: { user_id: { in: eligibleIds } },
        select: {
          user_id: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
          user_image: true,
          birthday: true,
          gender: true,
        },
      }),
      findClubNonMemberAssignments(this.prisma, {
        clubId: context.clubId,
        userIds: eligibleIds,
      }),
    ]);

    const nowDate = new Date();
    const todayMs = Date.UTC(
      nowDate.getUTCFullYear(),
      nowDate.getUTCMonth(),
      nowDate.getUTCDate(),
    );
    const gmStatusByUser = new Map<string, GmAnnualStatus>();
    for (const row of gmRows) {
      if (row.ecclesiastical_year_id !== context.year.year_id) continue;
      const status = (row.status ?? 'none') as GmAnnualStatus;
      const current = gmStatusByUser.get(row.user_id) ?? 'none';
      if (GM_STATUS_RANK[status] > GM_STATUS_RANK[current]) {
        gmStatusByUser.set(row.user_id, status);
      }
    }
    const assignmentsByUser = new Map<string, NonMemberAssignmentRow[]>();
    for (const row of assignments) {
      const list = assignmentsByUser.get(row.user_id) ?? [];
      list.push(row);
      assignmentsByUser.set(row.user_id, list);
    }

    const candidates = users.map((user): BaseCandidate => {
      const history = assignmentsByUser.get(user.user_id) ?? [];
      const currentRoles = history.filter(
        (row) =>
          row.ecclesiastical_year_id === context.year.year_id &&
          row.status === 'active' &&
          row.active &&
          (row.end_date === null || row.end_date.getTime() >= todayMs),
      );
      const gmAnnualStatus = gmStatusByUser.get(user.user_id) ?? 'none';
      const enrolled = (GM_ENROLLED_STATUSES as readonly string[]).includes(
        gmAnnualStatus,
      );
      const group: Group = !enrolled
        ? 'not_enrolled'
        : currentRoles.length > 0
          ? 'with_role'
          : 'available';
      return {
        user,
        displayName: displayName(user),
        group,
        gmAnnualStatus,
        eligibility: eligibility.get(user.user_id) as GuideMajorEligibility,
        currentRoles,
        holdsRoleInTargetSection: currentRoles.some(
          (row) =>
            row.club_section_id === context.sectionId &&
            isServiceRoleName(row.roles.role_name),
        ),
        serviceYears: new Set(history.map((row) => row.ecclesiastical_year_id))
          .size,
        history,
      };
    });

    return candidates.sort(
      (a, b) =>
        a.displayName.localeCompare(b.displayName, 'es') ||
        a.user.user_id.localeCompare(b.user.user_id),
    );
  }

  /** Page-only enrichment: photo, age, consent, GM extras and allowed roles. */
  private async buildItems(
    context: SectionContext,
    slotData: Awaited<ReturnType<ClubRoleCandidatesService['loadSlotData']>>,
    rows: BaseCandidate[],
    callerUserId: string,
  ) {
    if (rows.length === 0) return [];
    const userIds = rows.map((row) => row.user.user_id);
    const enrollmentIds = rows
      .map((row) => row.eligibility.enrollmentId)
      .filter((id): id is number => id !== null);

    const [consent, certRows, enrollments, photos] = await Promise.all([
      this.consentGate.loadDependentConsent(this.prisma, userIds),
      this.prisma.institutional_certificate_requests.findMany({
        where: {
          user_id: { in: userIds },
          status: 'APPROVED',
          active: true,
          class: {
            asset_code: {
              in: [GM_ADVANCED_ASSET_CODE, GM_INSTRUCTOR_ASSET_CODE],
            },
          },
        },
        select: { user_id: true, class: { select: { asset_code: true } } },
      }),
      this.prisma.enrollments.findMany({
        where: { enrollment_id: { in: enrollmentIds } },
        select: {
          enrollment_id: true,
          investiture_date: true,
          ecclesiastical_year: { select: { start_date: true, end_date: true } },
        },
      }),
      Promise.all(rows.map((row) => this.signPhoto(row.user.user_image))),
    ]);

    // Batched: one evaluation for the whole page (service roles only).
    const requirementsByUser = await this.roleRequirements.evaluate(
      this.prisma,
      {
        userIds,
        roleNames: [...SERVICE_ROLE_NAMES],
        clubTypeId: context.clubTypeId,
        today: new Date(),
      },
    );
    const roleOrder = (role: string) =>
      (SERVICE_ROLE_NAMES as readonly string[]).indexOf(role);

    const certCodes = new Map<string, Set<string>>();
    for (const row of certRows) {
      const set = certCodes.get(row.user_id) ?? new Set<string>();
      if (row.class.asset_code) set.add(row.class.asset_code);
      certCodes.set(row.user_id, set);
    }
    const enrollmentById = new Map(
      enrollments.map((row) => [row.enrollment_id, row]),
    );

    return rows.map((row, index) => {
      const userId = row.user.user_id;
      const state = consent.get(userId);
      const consentBlock = state
        ? { required: true, verified: state.verifiedAt !== null }
        : null;
      const allowance = evaluateServiceRoleAllowance({
        isSelf: userId === callerUserId,
        hasGmMembership: row.group !== 'not_enrolled',
        holdsRoleInTargetSection: row.holdsRoleInTargetSection,
        consentBlocked: consentBlock !== null && !consentBlock.verified,
        occupiedByRole: slotData.occupiedByRole,
        maxByRole: slotData.maxByRole,
      });
      const requirements = [...(requirementsByUser.get(userId) ?? [])].sort(
        (a, b) => roleOrder(a.role) - roleOrder(b.role),
      );
      // An enforced requirement that is not MET removes the role (no
      // blocked_reason: the app derives the per-role reason).
      const unmetRoles = new Set(
        requirements
          .filter((req) => req.enforced && req.status !== 'MET')
          .map((req) => req.role),
      );
      const allowedRoles = allowance.allowedRoles.filter(
        (role) => !unmetRoles.has(role),
      );
      const enrollment =
        row.eligibility.enrollmentId !== null
          ? enrollmentById.get(row.eligibility.enrollmentId)
          : undefined;
      const investitureYear =
        row.eligibility.basis === 'INVESTED' && enrollment
          ? enrollment.investiture_date
            ? String(enrollment.investiture_date.getUTCFullYear())
            : ecclesiasticalYearName(enrollment.ecclesiastical_year)
          : null;
      const codes = certCodes.get(userId);

      return {
        user_id: userId,
        name: row.displayName,
        photo_url: photos[index],
        age: row.user.birthday
          ? ageToday(row.user.birthday, ECCLESIASTICAL_YEAR_TIMEZONE)
          : null,
        // Only for the feminine/masculine role label («Subdirectora»).
        gender: row.user.gender ?? null,
        group: row.group,
        gm_annual_status: row.gmAnnualStatus,
        guide_major: {
          basis: row.eligibility.basis,
          investiture_year: investitureYear,
          advanced: codes?.has(GM_ADVANCED_ASSET_CODE) ?? false,
          instructor: codes?.has(GM_INSTRUCTOR_ASSET_CODE) ?? false,
        },
        current_roles: row.currentRoles.map((assignment) => ({
          section_id: assignment.club_section_id,
          club_type_id: assignment.club_sections?.club_type_id ?? null,
          club_type_name: assignment.club_sections?.club_types?.name ?? null,
          role: assignment.roles.role_name,
        })),
        service_years: row.serviceYears,
        consent: consentBlock,
        allowed_roles: allowedRoles,
        blocked_reason: allowance.blockedReason,
        requirements: requirements.map((req) => ({
          role: req.role,
          type: req.type,
          mode: req.mode,
          status: req.status,
          enforced: req.enforced,
        })),
      };
    });
  }

  private async loadInsurance(
    userId: string,
  ): Promise<{ active: boolean; expires_at: string | null } | null> {
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const [policies, assignments] = await Promise.all([
      this.prisma.member_insurances.findMany({
        where: { user_id: userId, active: true },
        select: { start_date: true, end_date: true },
      }),
      this.prisma.insurance_assignments.findMany({
        where: { user_id: userId, subject_type: 'MEMBER', status: 'ACTIVE' },
        select: { valid_from: true, valid_until: true },
      }),
    ]);
    const ranges = [
      ...policies.map((p) => ({ from: p.start_date, until: p.end_date })),
      ...assignments.map((a) => ({ from: a.valid_from, until: a.valid_until })),
    ];
    if (ranges.length === 0) return null;
    const covering = ranges.filter(
      (range) => range.from <= today && range.until >= today,
    );
    const pool = covering.length > 0 ? covering : ranges;
    const latest = pool.reduce((max, range) =>
      range.until > max.until ? range : max,
    );
    return {
      active: covering.length > 0,
      expires_at: latest.until.toISOString().slice(0, 10),
    };
  }

  private async signPhoto(value: string | null): Promise<string | null> {
    if (!value) return null;
    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        value,
        { expiresInSeconds: PHOTO_URL_TTL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to sign candidate photo: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
