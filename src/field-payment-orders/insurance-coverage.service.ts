import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { calendarDateInZone } from '../dashboard/dashboard-pending.period';
import { PrismaService } from '../prisma/prisma.service';

/** Prisma client or interactive transaction client. */
export type CoverageDb = Prisma.TransactionClient;

/** Order statuses that hold a person's place for the year ("live or paid"). */
export const LIVE_OR_PAID_ORDER_STATUSES = [
  'ISSUED',
  'PROOF_SUBMITTED',
  'PROOF_REJECTED',
  'APPROVED',
] as const;

const MEMBER_ROLE_NAME = 'member';
const BRIDGE_INSURANCE_TYPE = 'GENERAL_ACTIVITIES' as const;

export interface EcclesiasticalYearInfo {
  year_id: number;
  start_date: Date;
  end_date: Date;
}

export interface CoverageConflict {
  user_id: string;
  name: string;
  reason: 'already_covered' | 'in_live_order';
  section_name: string | null;
  club_name: string | null;
  folio: string | null;
  order_status?: string;
  valid_until?: string;
}

export interface SectionPerson {
  user_id: string;
  name: string;
  picture: string | null;
  is_staff: boolean;
  role_name: string;
  class_name: string | null;
}

export type PersonInsuranceStatus =
  'covered' | 'in_order' | 'in_review' | 'proof_rejected' | 'uninsured';

export interface OverviewCoverage {
  source: 'paid_here' | 'paid_elsewhere' | 'reassigned';
  paid_in_section_name: string | null;
  paid_in_club_name: string | null;
  order_folio: string | null;
  approved_at: string | null;
  valid_until: string;
  reassigned_from_name: string | null;
  reassigned_by_name: string | null;
  reassigned_at: string | null;
}

export interface OverviewPerson {
  user_id: string;
  name: string;
  picture: string | null;
  role_label: string;
  is_staff: boolean;
  status: PersonInsuranceStatus;
  coverage: OverviewCoverage | null;
  active_order: {
    order_id: string;
    folio: string;
    status: string;
    expires_at: string;
  } | null;
}

export interface FreeCoverage {
  insurance_assignment_id: number;
  holder: { user_id: string; name: string };
  valid_until: string;
  order_id: string | null;
  order_folio: string | null;
  left_at: string | null;
}

export interface SectionInsuranceOverview {
  year: {
    ecclesiastical_year_id: number;
    label: string;
    start_date: string;
    end_date: string;
  } | null;
  cycle: {
    insurance_cycle_config_id: number;
    unit_cost: string;
    purchase_deadline: string;
    currency: string;
  } | null;
  counts: {
    total: number;
    covered: number;
    in_process: number;
    uninsured: number;
  };
  free_coverages_count: number;
  people: OverviewPerson[];
}

type UserNameFields = {
  name: string | null;
  paternal_last_name: string | null;
  maternal_last_name: string | null;
};

export function formatUserName(user: UserNameFields | null | undefined) {
  if (!user) {
    return '';
  }
  return [user.name, user.paternal_last_name, user.maternal_last_name]
    .filter(Boolean)
    .join(' ');
}

const isoDate = (value: Date) => value.toISOString().slice(0, 10);

/** "2026" for a calendar ecclesiastical year, "2026-2027" when it spans two. */
export function yearLabel(start: Date, end: Date): string {
  const from = start.getUTCFullYear();
  const to = end.getUTCFullYear();
  return from === to ? `${from}` : `${from}-${to}`;
}

const USER_NAME_SELECT = {
  name: true,
  paternal_last_name: true,
  maternal_last_name: true,
} as const;

const STATUS_ORDER: Record<PersonInsuranceStatus, number> = {
  uninsured: 0,
  proof_rejected: 1,
  in_order: 1,
  in_review: 1,
  covered: 2,
};

/**
 * Single source of truth for the ANNUAL insurance model (one insurance per
 * person per ecclesiastical year, any LF/club/club type): eligibility,
 * coverage and live-order conflicts, the section overview and the bridge to
 * the legacy `member_insurances` table. "Covered" always means an ACTIVE
 * `insurance_assignments` row, never `member_insurances`.
 */
@Injectable()
export class InsuranceCoverageService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Dates / years ─────────────────────────────────────────────────────────

  /** Business "today" (America/Mexico_City) as a UTC-midnight date. */
  today(now: Date = new Date()): Date {
    const { year, month, day } = calendarDateInZone(now);
    return new Date(Date.UTC(year, month - 1, day));
  }

  async getCurrentYear(
    db: CoverageDb,
    now: Date = new Date(),
  ): Promise<EcclesiasticalYearInfo | null> {
    const today = this.today(now);
    return db.ecclesiastical_years.findFirst({
      where: { start_date: { lte: today }, end_date: { gte: today } },
      orderBy: { start_date: 'desc' },
      select: { year_id: true, start_date: true, end_date: true },
    });
  }

  // ── Eligibility ───────────────────────────────────────────────────────────

  /**
   * Active club role assignments (member or staff) of a section in the current
   * ecclesiastical year. `userIds` narrows the lookup.
   */
  private async findSectionAssignments(
    db: CoverageDb,
    clubSectionId: number,
    year: EcclesiasticalYearInfo | null,
    userIds?: string[],
  ) {
    return db.club_role_assignments.findMany({
      where: {
        club_section_id: clubSectionId,
        ...(userIds ? { user_id: { in: userIds } } : {}),
        active: true,
        status: 'active',
        ...(year ? { ecclesiastical_year_id: year.year_id } : {}),
      },
      select: {
        user_id: true,
        roles: { select: { role_name: true } },
        users: { select: { ...USER_NAME_SELECT, user_image: true } },
      },
    });
  }

  /**
   * Beneficiaries must be active members OR staff (directiva) of the section
   * in the current ecclesiastical year.
   */
  async assertSectionPeople(
    db: CoverageDb,
    clubSectionId: number,
    userIds: string[],
  ): Promise<void> {
    const year = await this.getCurrentYear(db);
    const rows = await this.findSectionAssignments(
      db,
      clubSectionId,
      year,
      userIds,
    );
    const eligible = new Set(rows.map((row) => row.user_id));
    const missing = userIds.filter((userId) => !eligible.has(userId));
    if (missing.length > 0) {
      throw new AppBadRequestException(
        ErrorCode.FIELD_PAYMENT_ORDER_ELIGIBILITY_FAILED,
        { reason: 'not_section_members', user_ids: missing },
      );
    }
  }

  /** Whether the user is an active member/staff of a specific section. */
  async isActiveInSection(
    db: CoverageDb,
    clubSectionId: number,
    userId: string,
  ): Promise<boolean> {
    const year = await this.getCurrentYear(db);
    const rows = await this.findSectionAssignments(db, clubSectionId, year, [
      userId,
    ]);
    return rows.length > 0;
  }

  /** User ids (of `userIds`) holding an active assignment in any section of the club. */
  async findActiveClubUserIds(
    db: CoverageDb,
    clubId: number,
    userIds: string[],
  ): Promise<Set<string>> {
    if (userIds.length === 0) {
      return new Set();
    }
    const year = await this.getCurrentYear(db);
    const rows = await db.club_role_assignments.findMany({
      where: {
        user_id: { in: userIds },
        active: true,
        status: 'active',
        club_sections: { main_club_id: clubId },
        ...(year ? { ecclesiastical_year_id: year.year_id } : {}),
      },
      select: { user_id: true },
    });
    return new Set(rows.map((row) => row.user_id));
  }

  /** Set of `${sectionId}:${userId}` for users holding a non-member (staff) role. */
  async findStaffKeys(
    db: CoverageDb,
    sectionIds: number[],
    userIds: string[],
  ): Promise<Set<string>> {
    if (sectionIds.length === 0 || userIds.length === 0) {
      return new Set();
    }
    const year = await this.getCurrentYear(db);
    const rows = await db.club_role_assignments.findMany({
      where: {
        user_id: { in: userIds },
        club_section_id: { in: sectionIds },
        active: true,
        status: 'active',
        roles: { role_name: { not: MEMBER_ROLE_NAME } },
        ...(year ? { ecclesiastical_year_id: year.year_id } : {}),
      },
      select: { user_id: true, club_section_id: true },
    });
    return new Set(rows.map((row) => `${row.club_section_id}:${row.user_id}`));
  }

  // ── Coverage / live-order conflicts ───────────────────────────────────────

  /**
   * ACTIVE assignments whose purchase cycle belongs to `yearId` and still valid
   * today — across every LF, club and club type.
   */
  async findCoverages(db: CoverageDb, yearId: number, userIds: string[]) {
    if (userIds.length === 0) {
      return [];
    }
    return db.insurance_assignments.findMany({
      where: {
        user_id: { in: userIds },
        subject_type: 'MEMBER',
        status: 'ACTIVE',
        valid_until: { gte: this.today() },
        coverage_slot: {
          purchase: { cycle_config: { ecclesiastical_year_id: yearId } },
        },
      },
      orderBy: { insurance_assignment_id: 'desc' },
      select: {
        insurance_assignment_id: true,
        user_id: true,
        valid_from: true,
        valid_until: true,
        confirmed_at: true,
        coverage_slot: {
          select: {
            insurance_coverage_slot_id: true,
            current_section_id: true,
            purchasing_section_id: true,
            purchasing_section: {
              select: {
                club_types: { select: { name: true } },
                clubs: { select: { name: true } },
              },
            },
            purchase: {
              select: {
                external_reference: true,
                reviewed_at: true,
                owner_club: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Frees the place held by ISSUED orders past `expires_at` that include any of
   * these users (lazy expiry would otherwise keep the unique guard taken).
   */
  async releaseExpiredOrders(
    db: CoverageDb,
    userIds: string[],
    now: Date = new Date(),
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    const due = await db.field_payment_orders.findMany({
      where: {
        purpose: 'INSURANCE',
        status: 'ISSUED',
        expires_at: { lt: now },
        lines: { some: { beneficiary_user_id: { in: userIds } } },
      },
      select: { field_payment_order_id: true },
    });
    if (due.length === 0) {
      return;
    }
    const ids = due.map((order) => order.field_payment_order_id);
    await db.field_payment_orders.updateMany({
      where: { field_payment_order_id: { in: ids }, status: 'ISSUED' },
      data: { status: 'EXPIRED', expired_at: now },
    });
    await db.field_payment_order_lines.updateMany({
      where: { field_payment_order_id: { in: ids } },
      data: { active_guard: false },
    });
  }

  /** Live-or-paid INSURANCE order lines of the year for these users. */
  async findLiveOrderLines(
    db: CoverageDb,
    yearId: number,
    userIds: string[],
    excludeOrderId?: string,
  ) {
    if (userIds.length === 0) {
      return [];
    }
    // field_payment_orders has no Prisma relation to the cycle: resolve the
    // year's cycle ids first.
    const cycles = await db.insurance_cycle_configs.findMany({
      where: { ecclesiastical_year_id: yearId },
      select: { insurance_cycle_config_id: true },
    });
    if (cycles.length === 0) {
      return [];
    }
    return db.field_payment_order_lines.findMany({
      where: {
        purpose: 'INSURANCE',
        beneficiary_user_id: { in: userIds },
        order: {
          status: { in: [...LIVE_OR_PAID_ORDER_STATUSES] },
          insurance_cycle_config_id: {
            in: cycles.map((cycle) => cycle.insurance_cycle_config_id),
          },
          ...(excludeOrderId
            ? { field_payment_order_id: { not: excludeOrderId } }
            : {}),
        },
      },
      select: {
        beneficiary_user_id: true,
        order: {
          select: {
            field_payment_order_id: true,
            folio_reference: true,
            status: true,
            expires_at: true,
            club_section_id: true,
          },
        },
      },
    });
  }

  /**
   * Rule: one insurance per person per ecclesiastical year, and never in two
   * live-or-paid orders of that year. Throws 409
   * FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY carrying, per conflicting user,
   * where it was paid / which order holds the place.
   */
  async assertCanBeInsured(
    db: CoverageDb,
    input: { yearId: number; userIds: string[]; excludeOrderId?: string },
  ): Promise<void> {
    const { yearId, userIds, excludeOrderId } = input;
    await this.releaseExpiredOrders(db, userIds);

    const [coverages, liveLines] = await Promise.all([
      this.findCoverages(db, yearId, userIds),
      this.findLiveOrderLines(db, yearId, userIds, excludeOrderId),
    ]);
    if (coverages.length === 0 && liveLines.length === 0) {
      return;
    }

    const conflicts = new Map<string, CoverageConflict>();
    for (const coverage of coverages) {
      if (!coverage.user_id || conflicts.has(coverage.user_id)) {
        continue;
      }
      const slot = coverage.coverage_slot;
      conflicts.set(coverage.user_id, {
        user_id: coverage.user_id,
        name: '',
        reason: 'already_covered',
        section_name: slot.purchasing_section?.club_types?.name ?? null,
        club_name:
          slot.purchasing_section?.clubs?.name ??
          slot.purchase.owner_club?.name ??
          null,
        folio: slot.purchase.external_reference ?? null,
        valid_until: isoDate(coverage.valid_until),
      });
    }

    const liveSectionIds = [
      ...new Set(liveLines.map((line) => line.order.club_section_id)),
    ];
    const liveSections = liveSectionIds.length
      ? await db.club_sections.findMany({
          where: { club_section_id: { in: liveSectionIds } },
          select: {
            club_section_id: true,
            club_types: { select: { name: true } },
            clubs: { select: { name: true } },
          },
        })
      : [];
    const sectionById = new Map(
      liveSections.map((section) => [section.club_section_id, section]),
    );
    for (const line of liveLines) {
      if (conflicts.has(line.beneficiary_user_id)) {
        continue;
      }
      const section = sectionById.get(line.order.club_section_id);
      conflicts.set(line.beneficiary_user_id, {
        user_id: line.beneficiary_user_id,
        name: '',
        reason: 'in_live_order',
        section_name: section?.club_types?.name ?? null,
        club_name: section?.clubs?.name ?? null,
        folio: line.order.folio_reference,
        order_status: line.order.status,
      });
    }

    const users = await db.users.findMany({
      where: { user_id: { in: [...conflicts.keys()] } },
      select: { user_id: true, ...USER_NAME_SELECT },
    });
    for (const user of users) {
      const conflict = conflicts.get(user.user_id);
      if (conflict) {
        conflict.name = formatUserName(user);
      }
    }

    const list = [...conflicts.values()];
    throw new AppConflictException(
      ErrorCode.FIELD_PAYMENT_ORDER_DUPLICATE_BENEFICIARY,
      { user_ids: list.map((conflict) => conflict.user_id) },
      { conflicts: list },
    );
  }

  // ── Legacy bridge (member_insurances) ─────────────────────────────────────

  /**
   * Camporees (and other legacy reads) still consult `member_insurances`:
   * extend an active GENERAL_ACTIVITIES row, or create the bridge row.
   */
  async upsertBridges(
    tx: CoverageDb,
    input: {
      userIds: string[];
      providerName: string;
      folioReference: string;
      validFrom: Date;
      validUntil: Date;
      actorId: string;
    },
  ): Promise<void> {
    const existing = await tx.member_insurances.findMany({
      where: {
        user_id: { in: input.userIds },
        insurance_type: BRIDGE_INSURANCE_TYPE,
        active: true,
        end_date: { gte: input.validFrom },
      },
      orderBy: { end_date: 'desc' },
    });
    const latestByUser = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      if (!latestByUser.has(row.user_id)) {
        latestByUser.set(row.user_id, row);
      }
    }

    const toExtendIds: number[] = [];
    const toCreate: string[] = [];
    for (const userId of input.userIds) {
      const row = latestByUser.get(userId);
      if (!row) {
        toCreate.push(userId);
        continue;
      }
      if (row.end_date < input.validUntil) {
        toExtendIds.push(row.insurance_id);
      }
    }

    if (toExtendIds.length > 0) {
      await tx.member_insurances.updateMany({
        where: { insurance_id: { in: toExtendIds } },
        data: { end_date: input.validUntil, modified_by_id: input.actorId },
      });
    }
    if (toCreate.length > 0) {
      await tx.member_insurances.createMany({
        data: toCreate.map((userId) => ({
          user_id: userId,
          insurance_type: BRIDGE_INSURANCE_TYPE,
          provider: input.providerName,
          policy_number: input.folioReference,
          start_date: input.validFrom,
          end_date: input.validUntil,
          active: true,
          created_by_id: input.actorId,
          modified_by_id: input.actorId,
        })),
      });
    }
  }

  /** Deactivates the bridge row(s) written for an order folio for one holder. */
  async deactivateBridge(
    tx: CoverageDb,
    input: { userId: string; folioReference: string | null; actorId: string },
  ): Promise<void> {
    await tx.member_insurances.updateMany({
      where: {
        user_id: input.userId,
        insurance_type: BRIDGE_INSURANCE_TYPE,
        active: true,
        ...(input.folioReference
          ? { policy_number: input.folioReference }
          : {}),
      },
      data: { active: false, modified_by_id: input.actorId },
    });
  }

  // ── Section overview ──────────────────────────────────────────────────────

  async getSectionPeople(
    db: CoverageDb,
    sectionId: number,
    year: EcclesiasticalYearInfo | null,
  ): Promise<SectionPerson[]> {
    const rows = await this.findSectionAssignments(db, sectionId, year);

    const byUser = new Map<string, SectionPerson>();
    for (const row of rows) {
      const isStaff = row.roles.role_name !== MEMBER_ROLE_NAME;
      const existing = byUser.get(row.user_id);
      // A person with a staff role is shown as staff even if also enrolled.
      if (existing && (existing.is_staff || !isStaff)) {
        continue;
      }
      byUser.set(row.user_id, {
        user_id: row.user_id,
        name: formatUserName(row.users),
        picture: row.users?.user_image ?? null,
        is_staff: isStaff,
        role_name: row.roles.role_name,
        class_name: null,
      });
    }

    const memberIds = [...byUser.values()]
      .filter((person) => !person.is_staff)
      .map((person) => person.user_id);
    if (memberIds.length > 0 && year) {
      const enrollments = await db.enrollments.findMany({
        where: {
          user_id: { in: memberIds },
          ecclesiastical_year_id: year.year_id,
          active: true,
        },
        select: { user_id: true, classes: { select: { name: true } } },
      });
      for (const enrollment of enrollments) {
        const person = byUser.get(enrollment.user_id);
        if (person) {
          person.class_name = enrollment.classes?.name ?? null;
        }
      }
    }
    return [...byUser.values()];
  }

  async getOverview(sectionId: number): Promise<SectionInsuranceOverview> {
    const db: CoverageDb = this.prisma;
    const now = new Date();
    const year = await this.getCurrentYear(db, now);
    if (!year) {
      return {
        year: null,
        cycle: null,
        counts: { total: 0, covered: 0, in_process: 0, uninsured: 0 },
        free_coverages_count: 0,
        people: [],
      };
    }

    const section = await db.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: {
        club_type_id: true,
        main_club_id: true,
        clubs: { select: { local_field_id: true } },
      },
    });

    const people = await this.getSectionPeople(db, sectionId, year);
    const userIds = people.map((person) => person.user_id);
    await this.releaseExpiredOrders(db, userIds, now);

    const localFieldId = section?.clubs?.local_field_id;
    const [cycle, coverages, liveLines, freeCoverages] = await Promise.all([
      section && typeof localFieldId === 'number'
        ? db.insurance_cycle_configs.findFirst({
            where: {
              local_field_id: localFieldId,
              club_type_id: section.club_type_id,
              ecclesiastical_year_id: year.year_id,
              active: true,
              product: { active: true },
            },
            orderBy: { insurance_cycle_config_id: 'asc' },
          })
        : Promise.resolve(null),
      this.findCoverages(db, year.year_id, userIds),
      this.findLiveOrderLines(db, year.year_id, userIds),
      this.getFreeCoverages(sectionId, { year, db }),
    ]);

    const coverageByUser = new Map<string, (typeof coverages)[number]>();
    for (const coverage of coverages) {
      if (coverage.user_id && !coverageByUser.has(coverage.user_id)) {
        coverageByUser.set(coverage.user_id, coverage);
      }
    }
    const orderByUser = new Map<string, (typeof liveLines)[number]['order']>();
    for (const line of liveLines) {
      orderByUser.set(line.beneficiary_user_id, line.order);
    }

    const reassignInfo = await this.loadReassignInfo(
      db,
      [...coverageByUser.values()].map(
        (coverage) => coverage.insurance_assignment_id,
      ),
      [...coverageByUser.values()].map(
        (coverage) => coverage.coverage_slot.insurance_coverage_slot_id,
      ),
    );

    const overviewPeople: OverviewPerson[] = people.map((person) => {
      const coverage = coverageByUser.get(person.user_id);
      const order = orderByUser.get(person.user_id);
      let status: PersonInsuranceStatus = 'uninsured';
      let coverageView: OverviewCoverage | null = null;
      if (coverage) {
        status = 'covered';
        const slot = coverage.coverage_slot;
        const reassigned = reassignInfo.get(coverage.insurance_assignment_id);
        coverageView = {
          source: reassigned
            ? 'reassigned'
            : slot.purchasing_section_id === sectionId
              ? 'paid_here'
              : 'paid_elsewhere',
          paid_in_section_name:
            slot.purchasing_section?.club_types?.name ?? null,
          paid_in_club_name:
            slot.purchasing_section?.clubs?.name ??
            slot.purchase.owner_club?.name ??
            null,
          order_folio: slot.purchase.external_reference ?? null,
          approved_at: slot.purchase.reviewed_at?.toISOString() ?? null,
          valid_until: isoDate(coverage.valid_until),
          reassigned_from_name: reassigned?.from_name ?? null,
          reassigned_by_name: reassigned?.by_name ?? null,
          reassigned_at: reassigned?.at ?? null,
        };
      } else if (
        order &&
        !(order.status === 'ISSUED' && order.expires_at < now)
      ) {
        status =
          order.status === 'PROOF_SUBMITTED'
            ? 'in_review'
            : order.status === 'PROOF_REJECTED'
              ? 'proof_rejected'
              : order.status === 'ISSUED'
                ? 'in_order'
                : 'uninsured';
      }

      const activeOrder =
        !coverage && status !== 'uninsured' && order
          ? {
              order_id: order.field_payment_order_id,
              folio: order.folio_reference,
              status: order.status,
              expires_at: order.expires_at.toISOString(),
            }
          : null;

      return {
        user_id: person.user_id,
        name: person.name,
        picture: person.picture,
        role_label: person.is_staff
          ? person.role_name
          : (person.class_name ?? 'Miembro'),
        is_staff: person.is_staff,
        status,
        coverage: coverageView,
        active_order: activeOrder,
      };
    });

    overviewPeople.sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        a.name.localeCompare(b.name),
    );

    const covered = overviewPeople.filter((p) => p.status === 'covered').length;
    const uninsured = overviewPeople.filter(
      (p) => p.status === 'uninsured',
    ).length;

    return {
      year: {
        ecclesiastical_year_id: year.year_id,
        label: yearLabel(year.start_date, year.end_date),
        start_date: isoDate(year.start_date),
        end_date: isoDate(year.end_date),
      },
      cycle: cycle
        ? {
            insurance_cycle_config_id: cycle.insurance_cycle_config_id,
            unit_cost: Number(cycle.unit_cost).toFixed(2),
            purchase_deadline: isoDate(cycle.purchase_deadline),
            currency: 'MXN',
          }
        : null,
      counts: {
        total: overviewPeople.length,
        covered,
        in_process: overviewPeople.length - covered - uninsured,
        uninsured,
      },
      free_coverages_count: freeCoverages.length,
      people: overviewPeople,
    };
  }

  /** Who reassigned each assignment (null entry => not a reassignment). */
  private async loadReassignInfo(
    db: CoverageDb,
    assignmentIds: number[],
    slotIds: number[],
  ): Promise<
    Map<
      number,
      { from_name: string | null; by_name: string | null; at: string }
    >
  > {
    const result = new Map<
      number,
      { from_name: string | null; by_name: string | null; at: string }
    >();
    if (assignmentIds.length === 0) {
      return result;
    }
    const movements = await db.insurance_slot_movements.findMany({
      where: {
        movement_type: 'REASSIGNED',
        insurance_assignment_id: { in: assignmentIds },
      },
      orderBy: { created_at: 'desc' },
      select: {
        insurance_assignment_id: true,
        insurance_coverage_slot_id: true,
        created_at: true,
        performer: { select: USER_NAME_SELECT },
      },
    });
    if (movements.length === 0) {
      return result;
    }
    const released = await db.insurance_assignments.findMany({
      where: {
        insurance_coverage_slot_id: { in: slotIds },
        status: 'RELEASED',
      },
      orderBy: { insurance_assignment_id: 'desc' },
      select: {
        insurance_coverage_slot_id: true,
        insurance_assignment_id: true,
        user_subject: { select: USER_NAME_SELECT },
      },
    });
    for (const movement of movements) {
      if (
        movement.insurance_assignment_id === null ||
        result.has(movement.insurance_assignment_id)
      ) {
        continue;
      }
      // The previous holder is the latest RELEASED assignment of the slot
      // created before this one.
      const previous = released.find(
        (row) =>
          row.insurance_coverage_slot_id ===
            movement.insurance_coverage_slot_id &&
          row.insurance_assignment_id < movement.insurance_assignment_id!,
      );
      result.set(movement.insurance_assignment_id, {
        from_name: previous ? formatUserName(previous.user_subject) : null,
        by_name: formatUserName(movement.performer) || null,
        at: movement.created_at.toISOString(),
      });
    }
    return result;
  }

  // ── Free insurance ────────────────────────────────────────────────────────

  /**
   * ACTIVE current-year valid coverages that belong to this section's slots
   * whose holder is no longer an active member/staff of the club: they can be
   * reassigned directly by the section leadership.
   */
  async getFreeCoverages(
    sectionId: number,
    preloaded?: { year: EcclesiasticalYearInfo | null; db: CoverageDb },
  ): Promise<FreeCoverage[]> {
    const db = preloaded?.db ?? this.prisma;
    const year = preloaded ? preloaded.year : await this.getCurrentYear(db);
    if (!year) {
      return [];
    }
    const section = await db.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { main_club_id: true },
    });
    if (!section?.main_club_id) {
      return [];
    }

    const assignments = await db.insurance_assignments.findMany({
      where: {
        subject_type: 'MEMBER',
        status: 'ACTIVE',
        user_id: { not: null },
        valid_until: { gte: this.today() },
        coverage_slot: {
          current_section_id: sectionId,
          purchase: { cycle_config: { ecclesiastical_year_id: year.year_id } },
        },
      },
      orderBy: { insurance_assignment_id: 'asc' },
      select: {
        insurance_assignment_id: true,
        user_id: true,
        valid_until: true,
        user_subject: { select: USER_NAME_SELECT },
        coverage_slot: {
          select: {
            assignments: { select: { insurance_assignment_id: true } },
            purchase: { select: { external_reference: true } },
          },
        },
      },
    });
    if (assignments.length === 0) {
      return [];
    }

    const holderIds = assignments.map((row) => row.user_id as string);
    const stillIn = await this.findActiveClubUserIds(
      db,
      section.main_club_id,
      holderIds,
    );
    const free = assignments.filter(
      (row) => !stillIn.has(row.user_id as string),
    );
    if (free.length === 0) {
      return [];
    }

    const freeHolderIds = free.map((row) => row.user_id as string);
    const [lines, leftRows] = await Promise.all([
      db.field_payment_order_lines.findMany({
        where: {
          insurance_assignment_id: {
            in: free.flatMap((row) =>
              row.coverage_slot.assignments.map(
                (assignment) => assignment.insurance_assignment_id,
              ),
            ),
          },
        },
        select: {
          insurance_assignment_id: true,
          order: {
            select: { field_payment_order_id: true, folio_reference: true },
          },
        },
      }),
      db.club_role_assignments.findMany({
        where: {
          user_id: { in: freeHolderIds },
          club_sections: { main_club_id: section.main_club_id },
        },
        orderBy: { modified_at: 'desc' },
        select: { user_id: true, end_date: true, modified_at: true },
      }),
    ]);
    const lineByAssignment = new Map(
      lines.map((line) => [line.insurance_assignment_id, line.order]),
    );
    const leftAtByUser = new Map<string, Date>();
    for (const row of leftRows) {
      if (!leftAtByUser.has(row.user_id)) {
        leftAtByUser.set(row.user_id, row.end_date ?? row.modified_at);
      }
    }

    return free.map((row) => {
      const slotAssignmentIds = row.coverage_slot.assignments.map(
        (assignment) => assignment.insurance_assignment_id,
      );
      const order =
        slotAssignmentIds
          .map((id) => lineByAssignment.get(id))
          .find((candidate) => candidate !== undefined) ?? null;
      const leftAt = leftAtByUser.get(row.user_id as string);
      return {
        insurance_assignment_id: row.insurance_assignment_id,
        holder: {
          user_id: row.user_id as string,
          name: formatUserName(row.user_subject),
        },
        valid_until: isoDate(row.valid_until),
        order_id: order?.field_payment_order_id ?? null,
        order_folio:
          order?.folio_reference ??
          row.coverage_slot.purchase.external_reference ??
          null,
        left_at: leftAt ? leftAt.toISOString() : null,
      };
    });
  }
}
