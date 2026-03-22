import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateUnitDto,
  UpdateUnitDto,
  AddUnitMemberDto,
  CreateWeeklyRecordDto,
  UpdateWeeklyRecordDto,
} from './dto';

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly unitInclude = {
    club_types: { select: { club_type_id: true, name: true } },
    club_sections: {
      select: { club_section_id: true, main_club_id: true },
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
    const unit = await this.prisma.units.findUnique({
      where: { unit_id: unitId },
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
    await this.findOne(unitId);

    const userExists = await this.prisma.users.findUnique({
      where: { user_id: dto.user_id },
      select: { user_id: true },
    });

    if (!userExists) {
      throw new NotFoundException(`User with ID ${dto.user_id} not found`);
    }

    const existing = await this.prisma.unit_members.findUnique({
      where: { user_id: dto.user_id },
    });

    if (existing) {
      if (existing.active) {
        throw new ConflictException(
          `User ${dto.user_id} is already a member of a unit`,
        );
      }

      return this.prisma.unit_members.update({
        where: { user_id: dto.user_id },
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

  async findWeeklyRecords(unitId: number) {
    const unit = await this.findOne(unitId);

    const memberUserIds = unit.unit_members
      .filter((m) => m.active)
      .map((m) => m.user_id);

    if (memberUserIds.length === 0) {
      return [];
    }

    return this.prisma.weekly_records.findMany({
      where: {
        user_id: { in: memberUserIds },
        active: true,
      },
      include: {
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            user_image: true,
          },
        },
      },
      orderBy: [{ week: 'asc' }, { user_id: 'asc' }],
    });
  }

  async createWeeklyRecord(unitId: number, dto: CreateWeeklyRecordDto) {
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
      where: { user_id_week: { user_id: dto.user_id, week: dto.week } },
    });

    if (existing) {
      throw new ConflictException(
        `Weekly record for user ${dto.user_id} on week ${dto.week} already exists`,
      );
    }

    return this.prisma.weekly_records.create({
      data: {
        user_id: dto.user_id,
        week: dto.week,
        attendance: dto.attendance,
        punctuality: dto.punctuality,
        points: dto.points,
        active: true,
        created_at: new Date(),
        modified_at: new Date(),
      },
      include: {
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            user_image: true,
          },
        },
      },
    });
  }

  async updateWeeklyRecord(
    unitId: number,
    recordId: number,
    dto: UpdateWeeklyRecordDto,
  ) {
    await this.findOne(unitId);

    const record = await this.prisma.weekly_records.findFirst({
      where: { record_id: recordId },
    });

    if (!record) {
      throw new NotFoundException(
        `Weekly record with ID ${recordId} not found`,
      );
    }

    const updateData: any = { modified_at: new Date() };

    if (dto.attendance !== undefined) updateData.attendance = dto.attendance;
    if (dto.punctuality !== undefined) updateData.punctuality = dto.punctuality;
    if (dto.points !== undefined) updateData.points = dto.points;
    if (dto.active !== undefined) updateData.active = dto.active;

    return this.prisma.weekly_records.update({
      where: { record_id: recordId },
      data: updateData,
      include: {
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            user_image: true,
          },
        },
      },
    });
  }
}
