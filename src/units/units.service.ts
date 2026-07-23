import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateUnitDto,
  UpdateUnitDto,
  AddUnitMemberDto,
  BulkUpsertWeeklyRecordsDto,
  CreateWeeklyRecordDto,
  UpdateWeeklyRecordDto,
} from './dto';
import { ScoringCategoriesService } from '../scoring-categories/scoring-categories.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

interface WeeklyRecordUserResponse {
  user_id: string;
  name: string | null;
  paternal_last_name: string | null;
  user_image: string | null;
}

interface WeeklyRecordScoreResponse {
  category_id: number;
  category_name: string;
  scoring_mode: 'numeric' | 'boolean_full';
  points: number;
  max_points: number;
}

export interface WeeklyRecordResponse {
  record_id: number;
  unit_id: number | null;
  user_id: string;
  week: number;
  year: number;
  attendance: number;
  punctuality: number;
  points: number;
  active: boolean;
  created_at: Date;
  modified_at: Date;
  users?: WeeklyRecordUserResponse;
  scores: WeeklyRecordScoreResponse[];
}

interface WeeklyRecordRaw extends Omit<WeeklyRecordResponse, 'scores'> {
  weekly_record_scores?: Array<{
    category_id: number;
    points: number;
    scoring_category: {
      scoring_category_id: number;
      name: string;
      max_points: number;
      scoring_mode: 'numeric' | 'boolean_full';
    } | null;
  }>;
}

@Injectable()
export class UnitsService {
  private readonly logger = new Logger(UnitsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringCategoriesService: ScoringCategoriesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private readonly unitInclude = {
    club_types: { select: { club_type_id: true, name: true } },
    club_sections: {
      select: {
        club_section_id: true,
        main_club_id: true,
        clubs: {
          select: {
            local_field_id: true,
          },
        },
      },
    },
    users_units_captain_idTousers: {
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        user_image: true,
      },
    },
    users_units_secretary_idTousers: {
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        user_image: true,
      },
    },
    users_units_advisor_idTousers: {
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        user_image: true,
      },
    },
    users_units_as_substitute_advisor: {
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        user_image: true,
      },
    },
    unit_members: {
      where: { active: true },
      select: {
        unit_member_id: true,
        user_id: true,
        active: true,
        created_at: true,
        users: {
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
  } as const;

  // ========================================
  // UNIDADES
  // ========================================

  async findByClub(clubId: number) {
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: {
        club_id: true,
        club_sections: {
          where: { active: true },
          select: { club_section_id: true },
        },
      },
    });

    if (!club) {
      throw new AppNotFoundException(ErrorCode.UNIT_CLUB_NOT_FOUND);
    }

    const sectionIds = club.club_sections.map((s) => s.club_section_id);

    if (sectionIds.length === 0) {
      return [];
    }

    return this.prisma.units.findMany({
      where: {
        active: true,
        club_section_id: { in: sectionIds },
      },
      include: this.unitInclude,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(unitId: number, clubId?: number) {
    const unit = await this.prisma.units.findFirst({
      where: {
        unit_id: unitId,
        active: true,
        ...(clubId !== undefined
          ? { club_sections: { main_club_id: clubId } }
          : {}),
      },
      include: this.unitInclude,
    });

    if (!unit) {
      throw new AppNotFoundException(ErrorCode.UNIT_NOT_FOUND);
    }

    return unit;
  }

  async create(clubId: number, dto: CreateUnitDto) {
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: { club_id: true },
    });

    if (!club) {
      throw new AppNotFoundException(ErrorCode.UNIT_CLUB_NOT_FOUND);
    }

    if (!dto.club_section_id) {
      throw new AppBadRequestException(ErrorCode.UNIT_SECTION_NOT_FOUND);
    }

    await this.validateSectionBelongsToClub(
      dto.club_section_id,
      clubId,
      dto.club_type_id,
    );

    return this.prisma.units.create({
      data: {
        name: dto.name,
        captain_id: dto.captain_id,
        secretary_id: dto.secretary_id,
        advisor_id: dto.advisor_id,
        substitute_advisor_id: dto.substitute_advisor_id,
        club_type_id: dto.club_type_id,
        club_section_id: dto.club_section_id,
        active: true,
        created_at: new Date(),
        modified_at: new Date(),
      },
      include: this.unitInclude,
    });
  }

  async update(unitId: number, dto: UpdateUnitDto, clubId?: number) {
    const existing = await this.findOne(unitId, clubId);

    if (dto.club_section_id !== undefined || dto.club_type_id !== undefined) {
      const targetClubId = clubId ?? existing.club_sections?.main_club_id;
      const targetSectionId = dto.club_section_id ?? existing.club_section_id;
      if (targetClubId == null) {
        throw new AppBadRequestException(ErrorCode.UNIT_SECTION_WRONG_CLUB);
      }
      if (targetSectionId === undefined || targetSectionId === null) {
        throw new AppBadRequestException(ErrorCode.UNIT_SECTION_NOT_FOUND);
      }
      await this.validateSectionBelongsToClub(
        targetSectionId,
        targetClubId,
        dto.club_type_id ?? existing.club_type_id,
      );
    }

    const updateData: any = { modified_at: new Date() };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.captain_id !== undefined) updateData.captain_id = dto.captain_id;
    if (dto.secretary_id !== undefined)
      updateData.secretary_id = dto.secretary_id;
    if (dto.advisor_id !== undefined) updateData.advisor_id = dto.advisor_id;
    if (dto.substitute_advisor_id !== undefined)
      updateData.substitute_advisor_id = dto.substitute_advisor_id;
    if (dto.club_type_id !== undefined)
      updateData.club_type_id = dto.club_type_id;
    if (dto.club_section_id !== undefined)
      updateData.club_section_id = dto.club_section_id;
    if (dto.active !== undefined) updateData.active = dto.active;

    return this.prisma.units.update({
      where: { unit_id: unitId },
      data: updateData,
      include: this.unitInclude,
    });
  }

  async remove(unitId: number, clubId?: number) {
    await this.findOne(unitId, clubId);

    return this.prisma.units.update({
      where: { unit_id: unitId },
      data: { active: false, modified_at: new Date() },
    });
  }

  // ========================================
  // MIEMBROS
  // ========================================

  async addMember(unitId: number, dto: AddUnitMemberDto, clubId?: number) {
    const unit = await this.findOne(unitId, clubId);

    const userExists = await this.prisma.users.findUnique({
      where: { user_id: dto.user_id },
      select: { user_id: true },
    });

    if (!userExists) {
      throw new AppNotFoundException(ErrorCode.UNIT_USER_NOT_FOUND);
    }

    // Service-layer validation: user can only be in ONE active unit per club_section
    if (unit.club_section_id) {
      const sectionAssignment =
        await this.prisma.club_role_assignments.findFirst({
          where: {
            user_id: dto.user_id,
            club_section_id: unit.club_section_id,
            active: true,
          },
        });

      if (!sectionAssignment) {
        throw new AppBadRequestException(ErrorCode.UNIT_USER_NOT_IN_SECTION);
      }

      const conflictingMembership = await this.prisma.unit_members.findFirst({
        where: {
          user_id: dto.user_id,
          active: true,
          units: {
            club_section_id: unit.club_section_id,
            active: true,
          },
        },
      });

      if (conflictingMembership) {
        throw new AppConflictException(
          ErrorCode.UNIT_MEMBER_ALREADY_IN_SECTION,
        );
      }
    }

    // Check if there's a previous membership in THIS unit (possibly inactive)
    const existingInThisUnit = await this.prisma.unit_members.findFirst({
      where: { unit_id: unitId, user_id: dto.user_id },
    });

    let result;
    if (existingInThisUnit) {
      if (existingInThisUnit.active) {
        throw new AppConflictException(ErrorCode.UNIT_MEMBER_ALREADY_IN_UNIT);
      }

      result = await this.prisma.unit_members.update({
        where: { unit_member_id: existingInThisUnit.unit_member_id },
        data: {
          unit_id: unitId,
          active: true,
          modified_at: new Date(),
        },
      });
    } else {
      result = await this.prisma.unit_members.create({
        data: {
          unit_id: unitId,
          user_id: dto.user_id,
          active: true,
          created_at: new Date(),
          modified_at: new Date(),
        },
      });
    }

    this.emitRealtimeInvalidation(
      unit.club_section_id,
      unitId,
      'UPDATED',
      dto.user_id,
    );

    return result;
  }

  async removeMember(unitId: number, memberId: number, clubId?: number) {
    const unit = await this.findOne(unitId, clubId);

    const member = await this.prisma.unit_members.findFirst({
      where: { unit_member_id: memberId, unit_id: unitId },
    });

    if (!member) {
      throw new AppNotFoundException(ErrorCode.UNIT_MEMBER_NOT_FOUND);
    }

    const removed = await this.prisma.unit_members.update({
      where: { unit_member_id: memberId },
      data: { active: false, modified_at: new Date() },
    });

    this.emitRealtimeInvalidation(unit.club_section_id, unitId, 'UPDATED');

    return removed;
  }

  // ========================================
  // REGISTROS SEMANALES
  // ========================================

  /**
   * Transforms a raw Prisma weekly_records row (with weekly_record_scores included)
   * into the flat response shape expected by the frontend and Flutter clients.
   */
  private transformWeeklyRecord(record: WeeklyRecordRaw): WeeklyRecordResponse {
    const { weekly_record_scores, ...rest } = record;
    return {
      ...rest,
      scores: (weekly_record_scores ?? []).map((wrs) => ({
        category_id: wrs.category_id,
        category_name: wrs.scoring_category?.name ?? '',
        scoring_mode: wrs.scoring_category?.scoring_mode ?? 'numeric',
        points: wrs.points,
        max_points: wrs.scoring_category?.max_points ?? 0,
      })),
    };
  }

  private readonly weeklyRecordInclude = {
    users: {
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        user_image: true,
      },
    },
    weekly_record_scores: {
      include: {
        scoring_category: {
          select: {
            scoring_category_id: true,
            name: true,
            max_points: true,
            scoring_mode: true,
          },
        },
      },
    },
  } as const;

  private preferUnitSpecificRecords<T extends WeeklyRecordRaw>(
    records: T[],
    unitId: number,
  ): T[] {
    const byUserWeekYear = new Map<string, T>();

    for (const record of records) {
      const key = `${record.user_id}:${record.year}:${record.week}`;
      const existing = byUserWeekYear.get(key);
      const isUnitSpecific = record.unit_id === unitId;

      if (!existing) {
        byUserWeekYear.set(key, record);
        continue;
      }

      if (existing.unit_id == null && isUnitSpecific) {
        byUserWeekYear.set(key, record);
      }
    }

    return Array.from(byUserWeekYear.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      if (a.week !== b.week) return a.week - b.week;
      return a.user_id.localeCompare(b.user_id);
    });
  }

  private getCurrentIsoPeriod(date = new Date()): {
    week: number;
    year: number;
  } {
    const target = new Date(date.valueOf());
    const dayNumber = (target.getDay() + 6) % 7; // Mon=0, Sun=6
    target.setDate(target.getDate() - dayNumber + 3); // Thursday anchors ISO year

    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const firstThursdayDayNumber = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstThursdayDayNumber + 3);

    return {
      week:
        1 +
        Math.round(
          (target.getTime() - firstThursday.getTime()) /
            (7 * 24 * 60 * 60 * 1000),
        ),
      year: target.getFullYear(),
    };
  }

  private assertWeeklyRecordPeriodIsOpen(week: number, year: number): void {
    const current = this.getCurrentIsoPeriod();

    if (year !== current.year || week !== current.week) {
      throw new AppBadRequestException(
        ErrorCode.UNIT_WEEKLY_RECORD_PERIOD_CLOSED,
      );
    }
  }

  private async validateScoreEntries(
    unit: Awaited<ReturnType<typeof this.findOne>>,
    scores?: { category_id: number; points: number }[],
  ): Promise<{
    calculatedPoints: number;
    validatedScores: { category_id: number; points: number }[];
  }> {
    let calculatedPoints = 0;
    const validatedScores: { category_id: number; points: number }[] = [];

    if (!scores || scores.length === 0) {
      return { calculatedPoints, validatedScores };
    }

    const localFieldId = this.resolveLocalFieldForUnit(unit);
    const availableCategories =
      localFieldId !== null
        ? await this.scoringCategoriesService.getActiveCategoriesForLocalField(
            localFieldId,
          )
        : [];

    const categoryMap = new Map(
      availableCategories.map((c) => [c.scoring_category_id, c]),
    );
    const seenCategoryIds = new Set<number>();

    for (const scoreEntry of scores) {
      if (seenCategoryIds.has(scoreEntry.category_id)) {
        throw new AppBadRequestException(
          ErrorCode.UNIT_SCORING_CATEGORY_INVALID,
        );
      }
      seenCategoryIds.add(scoreEntry.category_id);

      const category = categoryMap.get(scoreEntry.category_id);
      if (!category) {
        throw new AppBadRequestException(
          ErrorCode.UNIT_SCORING_CATEGORY_INVALID,
        );
      }
      if (scoreEntry.points < 0 || scoreEntry.points > category.max_points) {
        throw new AppBadRequestException(
          ErrorCode.UNIT_SCORING_POINTS_EXCEED_MAX,
        );
      }
      if (
        category.scoring_mode === 'boolean_full' &&
        scoreEntry.points !== 0 &&
        scoreEntry.points !== category.max_points
      ) {
        throw new AppBadRequestException(
          ErrorCode.UNIT_SCORING_BOOLEAN_POINTS_INVALID,
        );
      }
      calculatedPoints += scoreEntry.points;
      validatedScores.push({
        category_id: scoreEntry.category_id,
        points: scoreEntry.points,
      });
    }

    return { calculatedPoints, validatedScores };
  }

  async findWeeklyRecords(unitId: number, clubId?: number) {
    const unit = await this.findOne(unitId, clubId);

    const memberUserIds = unit.unit_members
      .filter((m) => m.active)
      .map((m) => m.user_id);

    if (memberUserIds.length === 0) {
      return [];
    }

    const records = await this.prisma.weekly_records.findMany({
      where: {
        user_id: { in: memberUserIds },
        active: true,
        OR: [{ unit_id: unitId }, { unit_id: null }],
      },
      include: this.weeklyRecordInclude,
      orderBy: [{ year: 'desc' }, { week: 'asc' }, { user_id: 'asc' }],
    });

    return this.preferUnitSpecificRecords(records, unitId).map((r) =>
      this.transformWeeklyRecord(r),
    );
  }

  async createWeeklyRecord(
    unitId: number,
    dto: CreateWeeklyRecordDto,
    userId: string,
    clubId?: number,
  ) {
    this.assertWeeklyRecordPeriodIsOpen(dto.week, dto.year);

    const unit = await this.findOne(unitId, clubId);

    const isMember = unit.unit_members.some(
      (m) => m.user_id === dto.user_id && m.active,
    );

    if (!isMember) {
      throw new AppBadRequestException(ErrorCode.UNIT_MEMBER_NOT_ACTIVE);
    }

    const existing = await this.prisma.weekly_records.findFirst({
      where: {
        unit_id: unitId,
        user_id: dto.user_id,
        week: dto.week,
        year: dto.year,
      },
    });

    if (existing) {
      throw new AppConflictException(ErrorCode.UNIT_WEEKLY_RECORD_DUPLICATE);
    }

    const { calculatedPoints, validatedScores } =
      await this.validateScoreEntries(unit, dto.scores);

    // Use transaction for atomic create
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.weekly_records.create({
        data: {
          unit_id: unitId,
          user_id: dto.user_id,
          week: dto.week,
          year: dto.year,
          attendance: dto.attendance ?? 0,
          punctuality: dto.punctuality ?? 0,
          points: calculatedPoints,
          active: true,
          created_by: userId,
          created_at: new Date(),
          modified_at: new Date(),
        },
      });

      if (validatedScores.length > 0) {
        await tx.weekly_record_scores.createMany({
          data: validatedScores.map((s) => ({
            record_id: record.record_id,
            category_id: s.category_id,
            points: s.points,
          })),
        });
      }

      const created = await tx.weekly_records.findUnique({
        where: { record_id: record.record_id },
        include: this.weeklyRecordInclude,
      });

      if (!created) {
        throw new AppInternalServerErrorException(
          ErrorCode.INTERNAL_SERVER_ERROR,
        );
      }
      return this.transformWeeklyRecord(created);
    });
  }

  async bulkUpsertWeeklyRecords(
    unitId: number,
    dto: BulkUpsertWeeklyRecordsDto,
    userId: string,
    clubId?: number,
  ) {
    this.assertWeeklyRecordPeriodIsOpen(dto.week, dto.year);

    const unit = await this.findOne(unitId, clubId);
    const activeMemberUserIds = new Set(
      unit.unit_members.filter((m) => m.active).map((m) => m.user_id),
    );
    const seenUserIds = new Set<string>();

    const preparedRecords: Array<{
      user_id: string;
      attendance: number;
      punctuality: number;
      calculatedPoints: number;
      validatedScores: { category_id: number; points: number }[];
    }> = [];

    for (const entry of dto.records) {
      if (seenUserIds.has(entry.user_id)) {
        throw new AppBadRequestException(
          ErrorCode.UNIT_WEEKLY_RECORD_DUPLICATE_USER,
        );
      }
      seenUserIds.add(entry.user_id);

      if (!activeMemberUserIds.has(entry.user_id)) {
        throw new AppBadRequestException(ErrorCode.UNIT_MEMBER_NOT_ACTIVE);
      }

      const { calculatedPoints, validatedScores } =
        await this.validateScoreEntries(unit, entry.scores);

      preparedRecords.push({
        user_id: entry.user_id,
        attendance: entry.attendance ?? 0,
        punctuality: entry.punctuality ?? 0,
        calculatedPoints,
        validatedScores,
      });
    }

    return this.prisma.$transaction(
      async (tx) => {
        const recordByUserId = new Map<string, { record_id: number }>();

        for (const entry of preparedRecords) {
          const record = await tx.weekly_records.upsert({
            where: {
              unit_id_user_id_week_year: {
                unit_id: unitId,
                user_id: entry.user_id,
                week: dto.week,
                year: dto.year,
              },
            },
            create: {
              unit_id: unitId,
              user_id: entry.user_id,
              week: dto.week,
              year: dto.year,
              attendance: entry.attendance,
              punctuality: entry.punctuality,
              points: entry.calculatedPoints,
              active: true,
              created_by: userId,
              created_at: new Date(),
              modified_at: new Date(),
            },
            update: {
              attendance: entry.attendance,
              punctuality: entry.punctuality,
              active: true,
              modified_at: new Date(),
            },
          });
          recordByUserId.set(entry.user_id, record);
        }

        const scoreWrites = preparedRecords.flatMap((entry) => {
          const record = recordByUserId.get(entry.user_id)!;
          return entry.validatedScores.map((score) => ({
            record_id: record.record_id,
            category_id: score.category_id,
            points: score.points,
          }));
        });

        if (scoreWrites.length > 0) {
          await tx.weekly_record_scores.deleteMany({
            where: {
              OR: preparedRecords
                .filter((entry) => entry.validatedScores.length > 0)
                .map((entry) => ({
                  record_id: recordByUserId.get(entry.user_id)!.record_id,
                  category_id: {
                    in: entry.validatedScores.map((score) => score.category_id),
                  },
                })),
            },
          });
          await tx.weekly_record_scores.createMany({ data: scoreWrites });

          const allScores = await tx.weekly_record_scores.findMany({
            where: {
              record_id: {
                in: Array.from(recordByUserId.values()).map(
                  (record) => record.record_id,
                ),
              },
            },
            select: { record_id: true, points: true },
          });
          const pointsByRecordId = new Map<number, number>();
          for (const score of allScores) {
            pointsByRecordId.set(
              score.record_id,
              (pointsByRecordId.get(score.record_id) ?? 0) + score.points,
            );
          }

          for (const record of recordByUserId.values()) {
            await tx.weekly_records.update({
              where: { record_id: record.record_id },
              data: {
                points: pointsByRecordId.get(record.record_id) ?? 0,
                modified_at: new Date(),
              },
            });
          }
        }

        const hydratedRecords = await tx.weekly_records.findMany({
          where: {
            record_id: {
              in: Array.from(recordByUserId.values()).map(
                (record) => record.record_id,
              ),
            },
          },
          include: this.weeklyRecordInclude,
        });
        const hydratedByUserId = new Map(
          hydratedRecords.map((record) => [record.user_id, record]),
        );

        return preparedRecords.map((entry) => {
          const hydrated = hydratedByUserId.get(entry.user_id);
          if (!hydrated) {
            throw new AppInternalServerErrorException(
              ErrorCode.INTERNAL_SERVER_ERROR,
            );
          }
          return this.transformWeeklyRecord(hydrated);
        });
      },
      { timeout: 15_000 },
    );
  }

  async updateWeeklyRecord(
    unitId: number,
    recordId: number,
    dto: UpdateWeeklyRecordDto,
    clubId?: number,
  ) {
    const unit = await this.findOne(unitId, clubId);

    const record = await this.prisma.weekly_records.findFirst({
      where: { record_id: recordId },
    });

    if (!record) {
      throw new AppNotFoundException(ErrorCode.UNIT_WEEKLY_RECORD_NOT_FOUND);
    }

    this.assertWeeklyRecordPeriodIsOpen(record.week, record.year);

    const recordUnitId =
      (record as { unit_id?: number | null }).unit_id ?? null;
    if (recordUnitId !== null && recordUnitId !== unitId) {
      throw new AppForbiddenException(ErrorCode.UNIT_WEEKLY_RECORD_WRONG_UNIT);
    }

    // C3: Verify the record belongs to an active member of this unit.
    // Legacy records may have unit_id = null, so membership remains the fallback.
    const isMemberOfUnit = await this.prisma.unit_members.findFirst({
      where: { unit_id: unitId, user_id: record.user_id, active: true },
    });
    if (!isMemberOfUnit) {
      throw new AppForbiddenException(ErrorCode.UNIT_WEEKLY_RECORD_WRONG_UNIT);
    }

    // Validate and process scores if provided
    let newCalculatedPoints: number | undefined;
    const validatedScores: { category_id: number; points: number }[] = [];

    if (dto.scores && dto.scores.length > 0) {
      const validated = await this.validateScoreEntries(unit, dto.scores);
      validatedScores.push(...validated.validatedScores);
    }

    return this.prisma.$transaction(async (tx) => {
      // Upsert each score entry
      for (const scoreEntry of validatedScores) {
        await tx.weekly_record_scores.upsert({
          where: {
            record_id_category_id: {
              record_id: recordId,
              category_id: scoreEntry.category_id,
            },
          },
          update: { points: scoreEntry.points },
          create: {
            record_id: recordId,
            category_id: scoreEntry.category_id,
            points: scoreEntry.points,
          },
        });
      }

      // Recalculate total points if scores changed
      if (validatedScores.length > 0) {
        const allScores = await tx.weekly_record_scores.findMany({
          where: { record_id: recordId },
          select: { points: true },
        });
        newCalculatedPoints = allScores.reduce((sum, s) => sum + s.points, 0);
      }

      const updateData: any = { modified_at: new Date() };
      if (dto.attendance !== undefined) updateData.attendance = dto.attendance;
      if (dto.punctuality !== undefined)
        updateData.punctuality = dto.punctuality;
      if (dto.active !== undefined) updateData.active = dto.active;
      if (newCalculatedPoints !== undefined)
        updateData.points = newCalculatedPoints;

      const updated = await tx.weekly_records.update({
        where: { record_id: recordId },
        data: updateData,
        include: this.weeklyRecordInclude,
      });

      return this.transformWeeklyRecord(updated);
    });
  }

  // ========================================
  // Helpers
  // ========================================

  private async validateSectionBelongsToClub(
    sectionId: number,
    clubId: number,
    expectedClubTypeId?: number,
  ): Promise<void> {
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { active: true, main_club_id: true, club_type_id: true },
    });

    if (!section || !section.active) {
      throw new AppBadRequestException(ErrorCode.UNIT_SECTION_NOT_FOUND);
    }

    if (section.main_club_id !== clubId) {
      throw new AppBadRequestException(ErrorCode.UNIT_SECTION_WRONG_CLUB);
    }

    if (
      expectedClubTypeId !== undefined &&
      section.club_type_id !== expectedClubTypeId
    ) {
      throw new AppBadRequestException(ErrorCode.UNIT_SECTION_TYPE_MISMATCH);
    }
  }

  /**
   * Resolves the local_field_id for a given unit by traversing:
   * unit → club_section → clubs → local_field_id
   */
  private resolveLocalFieldForUnit(
    unit: Awaited<ReturnType<typeof this.findOne>>,
  ): number | null {
    const localFieldId = unit.club_sections?.clubs?.local_field_id ?? null;
    return localFieldId;
  }

  private emitRealtimeInvalidation(
    sectionId: number | null | undefined,
    entityId: number | string,
    action: 'CREATED' | 'UPDATED' | 'DELETED',
    actorId?: string,
  ): void {
    if (!sectionId) return;
    this.notificationsService
      .sendSilentToSection({
        sectionId,
        resource: 'members',
        action,
        entityId,
        actorId: actorId ?? 'system',
        timestamp: new Date().toISOString(),
      })
      .catch((err: Error) =>
        this.logger.error(
          `emitRealtimeInvalidation failed (section=${sectionId}, entity=${entityId}, action=${action}): ${err.message}`,
        ),
      );
  }
}
