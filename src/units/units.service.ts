import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateUnitDto,
  UpdateUnitDto,
  AddUnitMemberDto,
  CreateWeeklyRecordDto,
  UpdateWeeklyRecordDto,
} from './dto';
import { ScoringCategoriesService } from '../scoring-categories/scoring-categories.service';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringCategoriesService: ScoringCategoriesService,
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
        club_sections: { select: { club_section_id: true } },
      },
    });

    if (!club) {
      throw new NotFoundException(`Club with ID ${clubId} not found`);
    }

    const sectionIds = club.club_sections.map((s) => s.club_section_id);

    return this.prisma.units.findMany({
      where: {
        active: true,
        ...(sectionIds.length > 0
          ? { club_section_id: { in: sectionIds } }
          : {}),
      },
      include: this.unitInclude,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(unitId: number) {
    const unit = await this.prisma.units.findFirst({
      where: { unit_id: unitId, active: true },
      include: this.unitInclude,
    });

    if (!unit) {
      throw new NotFoundException(`Unit with ID ${unitId} not found`);
    }

    return unit;
  }

  async create(clubId: number, dto: CreateUnitDto) {
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: { club_id: true },
    });

    if (!club) {
      throw new NotFoundException(`Club with ID ${clubId} not found`);
    }

    if (dto.club_section_id) {
      const section = await this.prisma.club_sections.findUnique({
        where: { club_section_id: dto.club_section_id },
        select: { main_club_id: true },
      });

      if (!section) {
        throw new BadRequestException(
          `Sección ${dto.club_section_id} no existe`,
        );
      }

      if (section.main_club_id !== clubId) {
        throw new BadRequestException(
          `Sección ${dto.club_section_id} no pertenece al clubId=${clubId}`,
        );
      }
    }

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

  async update(unitId: number, dto: UpdateUnitDto) {
    await this.findOne(unitId);

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

  async remove(unitId: number) {
    await this.findOne(unitId);

    return this.prisma.units.update({
      where: { unit_id: unitId },
      data: { active: false, modified_at: new Date() },
    });
  }

  // ========================================
  // MIEMBROS
  // ========================================

  async addMember(unitId: number, dto: AddUnitMemberDto) {
    const unit = await this.findOne(unitId);

    const userExists = await this.prisma.users.findUnique({
      where: { user_id: dto.user_id },
      select: { user_id: true },
    });

    if (!userExists) {
      throw new NotFoundException(`User with ID ${dto.user_id} not found`);
    }

    // Service-layer validation: user can only be in ONE active unit per club_section
    if (unit.club_section_id) {
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
        throw new ConflictException(
          'El miembro ya pertenece a una unidad activa en esta sección.',
        );
      }
    }

    // Check if there's a previous membership in THIS unit (possibly inactive)
    const existingInThisUnit = await this.prisma.unit_members.findFirst({
      where: { unit_id: unitId, user_id: dto.user_id },
    });

    if (existingInThisUnit) {
      if (existingInThisUnit.active) {
        throw new ConflictException(
          `User ${dto.user_id} is already an active member of unit ${unitId}`,
        );
      }

      return this.prisma.unit_members.update({
        where: { unit_member_id: existingInThisUnit.unit_member_id },
        data: {
          unit_id: unitId,
          active: true,
          modified_at: new Date(),
        },
      });
    }

    return this.prisma.unit_members.create({
      data: {
        unit_id: unitId,
        user_id: dto.user_id,
        active: true,
        created_at: new Date(),
        modified_at: new Date(),
      },
    });
  }

  async removeMember(unitId: number, memberId: number) {
    await this.findOne(unitId);

    const member = await this.prisma.unit_members.findFirst({
      where: { unit_member_id: memberId, unit_id: unitId },
    });

    if (!member) {
      throw new NotFoundException(
        `Member with ID ${memberId} not found in unit ${unitId}`,
      );
    }

    return this.prisma.unit_members.update({
      where: { unit_member_id: memberId },
      data: { active: false, modified_at: new Date() },
    });
  }

  // ========================================
  // REGISTROS SEMANALES
  // ========================================

  /**
   * Transforms a raw Prisma weekly_records row (with weekly_record_scores included)
   * into the flat response shape expected by the frontend and Flutter clients.
   */
  private transformWeeklyRecord(
    record: {
      record_id: number;
      user_id: string;
      week: number;
      year: number;
      attendance: number;
      punctuality: number;
      points: number;
      active: boolean;
      created_at: Date;
      modified_at: Date;
      users?: {
        user_id: string;
        name: string | null;
        paternal_last_name: string | null;
        user_image: string | null;
      };
      weekly_record_scores?: Array<{
        category_id: number;
        points: number;
        scoring_category: {
          scoring_category_id: number;
          name: string;
          max_points: number;
        } | null;
      }>;
    },
  ) {
    const { weekly_record_scores, ...rest } = record;
    return {
      ...rest,
      scores: (weekly_record_scores ?? []).map((wrs) => ({
        category_id: wrs.category_id,
        category_name: wrs.scoring_category?.name ?? '',
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
          },
        },
      },
    },
  } as const;

  async findWeeklyRecords(unitId: number) {
    const unit = await this.findOne(unitId);

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
      },
      include: this.weeklyRecordInclude,
      orderBy: [{ year: 'desc' }, { week: 'asc' }, { user_id: 'asc' }],
    });

    return records.map((r) => this.transformWeeklyRecord(r));
  }

  async createWeeklyRecord(unitId: number, dto: CreateWeeklyRecordDto, userId: string) {
    const unit = await this.findOne(unitId);

    const isMember = unit.unit_members.some(
      (m) => m.user_id === dto.user_id && m.active,
    );

    if (!isMember) {
      throw new BadRequestException(
        `User ${dto.user_id} is not an active member of unit ${unitId}`,
      );
    }

    const existing = await this.prisma.weekly_records.findUnique({
      where: {
        user_id_week_year: { user_id: dto.user_id, week: dto.week, year: dto.year },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Weekly record for user ${dto.user_id} on week ${dto.week}/${dto.year} already exists`,
      );
    }

    // Validate and resolve scores if provided
    let calculatedPoints = 0;
    const validatedScores: { category_id: number; points: number }[] = [];

    if (dto.scores && dto.scores.length > 0) {
      const localFieldId = await this.resolveLocalFieldForUnit(unit);
      const availableCategories =
        localFieldId !== null
          ? await this.scoringCategoriesService.getActiveCategoriesForLocalField(
              localFieldId,
            )
          : [];

      const categoryMap = new Map(
        availableCategories.map((c) => [c.scoring_category_id, c]),
      );

      for (const scoreEntry of dto.scores) {
        const category = categoryMap.get(scoreEntry.category_id);
        if (!category) {
          throw new BadRequestException(
            `Category ${scoreEntry.category_id} is not active or not available for this club's local field`,
          );
        }
        if (scoreEntry.points > category.max_points) {
          throw new BadRequestException(
            `Points ${scoreEntry.points} exceeds max_points ${category.max_points} for category "${category.name}"`,
          );
        }
        calculatedPoints += scoreEntry.points;
        validatedScores.push({
          category_id: scoreEntry.category_id,
          points: scoreEntry.points,
        });
      }
    }

    // Use transaction for atomic create
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.weekly_records.create({
        data: {
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

      return this.transformWeeklyRecord(created!);
    });
  }

  async updateWeeklyRecord(
    unitId: number,
    recordId: number,
    dto: UpdateWeeklyRecordDto,
  ) {
    const unit = await this.findOne(unitId);

    const record = await this.prisma.weekly_records.findFirst({
      where: { record_id: recordId },
    });

    if (!record) {
      throw new NotFoundException(
        `Weekly record with ID ${recordId} not found`,
      );
    }

    // C3: Verify the record belongs to an active member of this unit
    const isMemberOfUnit = await this.prisma.unit_members.findFirst({
      where: { unit_id: unitId, user_id: record.user_id, active: true },
    });
    if (!isMemberOfUnit) {
      throw new ForbiddenException(
        'El registro no pertenece a un miembro de esta unidad',
      );
    }

    // Validate and process scores if provided
    let newCalculatedPoints: number | undefined;
    const validatedScores: { category_id: number; points: number }[] = [];

    if (dto.scores && dto.scores.length > 0) {
      const localFieldId = await this.resolveLocalFieldForUnit(unit);
      const availableCategories =
        localFieldId !== null
          ? await this.scoringCategoriesService.getActiveCategoriesForLocalField(
              localFieldId,
            )
          : [];

      const categoryMap = new Map(
        availableCategories.map((c) => [c.scoring_category_id, c]),
      );

      for (const scoreEntry of dto.scores) {
        const category = categoryMap.get(scoreEntry.category_id);
        if (!category) {
          throw new BadRequestException(
            `Category ${scoreEntry.category_id} is not active or not available for this club's local field`,
          );
        }
        if (scoreEntry.points > category.max_points) {
          throw new BadRequestException(
            `Points ${scoreEntry.points} exceeds max_points ${category.max_points} for category "${category.name}"`,
          );
        }
        validatedScores.push({
          category_id: scoreEntry.category_id,
          points: scoreEntry.points,
        });
      }
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

  /**
   * Resolves the local_field_id for a given unit by traversing:
   * unit → club_section → clubs → local_field_id
   */
  private resolveLocalFieldForUnit(
    unit: Awaited<ReturnType<typeof this.findOne>>,
  ): number | null {
    const localFieldId =
      unit.club_sections?.clubs?.local_field_id ?? null;
    return localFieldId;
  }
}
