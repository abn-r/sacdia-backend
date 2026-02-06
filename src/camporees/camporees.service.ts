import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import { CreateCamporeeDto } from './dto/create-camporee.dto';
import { UpdateCamporeeDto } from './dto/update-camporee.dto';
import { RegisterMemberDto } from './dto/register-member.dto';
import { buildPartialUpdate } from '../common/utils/dto.utils';

@Injectable()
export class CamporeesService {
  constructor(private readonly prisma: PrismaService) {}

  // ========================================
  // CRUD FOR LOCAL_CAMPOREES
  // ========================================

  /**
   * Find all local camporees with pagination
   * @param filters - Filter by active status
   * @param pagination - Pagination parameters
   */
  async findAll(
    filters?: { active?: boolean },
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<any>> {
    const where: any = {};

    if (filters?.active !== undefined) {
      where.active = filters.active;
    }

    const [data, total] = await Promise.all([
      this.prisma.local_camporees.findMany({
        where,
        include: {
          local_fields: {
            select: {
              local_field_id: true,
              name: true,
              abbreviation: true,
            },
          },
          ecclesiastical_year_relation: {
            select: {
              year_id: true,
              start_date: true,
              end_date: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 20,
      }),
      this.prisma.local_camporees.count({ where }),
    ]);

    return createPaginatedResult(
      data,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  /**
   * Find a single local camporee by ID
   * @param camporeeId - The local_camporee_id
   */
  async findOne(camporeeId: number) {
    const camporee = await this.prisma.local_camporees.findUnique({
      where: { local_camporee_id: camporeeId },
      include: {
        local_fields: {
          select: {
            local_field_id: true,
            name: true,
            abbreviation: true,
          },
        },
        ecclesiastical_year_relation: {
          select: {
            year_id: true,
            start_date: true,
            end_date: true,
          },
        },
        attending_members_camporees: {
          where: { active: true },
          select: {
            camporee_member_id: true,
            user_id: true,
            insurance_verified: true,
          },
        },
      },
    });

    if (!camporee) {
      throw new NotFoundException(`Camporee with ID ${camporeeId} not found`);
    }

    return camporee;
  }

  /**
   * Create a new local camporee
   * @param dto - Create camporee DTO
   * @param createdBy - User ID creating the camporee (not used in schema but kept for future use)
   */
  async create(dto: CreateCamporeeDto, createdBy: string) {
    // Get the active ecclesiastical year
    const activeYear = await this.prisma.ecclesiastical_years.findFirst({
      where: { active: true },
      orderBy: { start_date: 'desc' },
    });

    if (!activeYear) {
      throw new BadRequestException(
        'No active ecclesiastical year found. Please activate an ecclesiastical year first.',
      );
    }

    // Validate local field exists
    const localField = await this.prisma.local_fields.findUnique({
      where: { local_field_id: dto.local_field_id },
    });

    if (!localField) {
      throw new BadRequestException(
        `Local field with ID ${dto.local_field_id} not found`,
      );
    }

    return this.prisma.local_camporees.create({
      data: {
        name: dto.name,
        description: dto.description,
        start_date: new Date(dto.start_date),
        end_date: new Date(dto.end_date),
        local_field_id: dto.local_field_id,
        includes_adventurers: dto.includes_adventurers,
        includes_pathfinders: dto.includes_pathfinders,
        includes_master_guides: dto.includes_master_guides,
        local_camporee_place: dto.local_camporee_place,
        registration_cost: dto.registration_cost,
        ecclesiastical_year: activeYear.year_id,
        active: true,
      },
      include: {
        local_fields: {
          select: {
            local_field_id: true,
            name: true,
            abbreviation: true,
          },
        },
        ecclesiastical_year_relation: {
          select: {
            year_id: true,
            start_date: true,
            end_date: true,
          },
        },
      },
    });
  }

  /**
   * Update a local camporee
   * @param camporeeId - The local_camporee_id
   * @param dto - Update camporee DTO
   */
  async update(camporeeId: number, dto: UpdateCamporeeDto) {
    await this.findOne(camporeeId);

    // Build update object with only defined fields, converting date fields
    const updateData = {
      ...buildPartialUpdate(dto, ['start_date', 'end_date']),
      modified_at: new Date(),
    };

    return this.prisma.local_camporees.update({
      where: { local_camporee_id: camporeeId },
      data: updateData,
      include: {
        local_fields: {
          select: {
            local_field_id: true,
            name: true,
            abbreviation: true,
          },
        },
        ecclesiastical_year_relation: {
          select: {
            year_id: true,
            start_date: true,
            end_date: true,
          },
        },
      },
    });
  }

  /**
   * Soft delete a local camporee (set active = false)
   * @param camporeeId - The local_camporee_id
   */
  async remove(camporeeId: number) {
    await this.findOne(camporeeId);

    return this.prisma.local_camporees.update({
      where: { local_camporee_id: camporeeId },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });
  }

  // ========================================
  // MEMBER REGISTRATION WITH TRANSACTIONS
  // ========================================

  /**
   * Register a member in a camporee with insurance validation
   * Uses Prisma transactions to ensure data integrity
   * @param camporeeId - The local_camporee_id
   * @param dto - Register member DTO
   */
  async registerMember(camporeeId: number, dto: RegisterMemberDto) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Validate camporee exists
      const camporee = await tx.local_camporees.findUnique({
        where: { local_camporee_id: camporeeId },
      });

      if (!camporee) {
        throw new NotFoundException('Camporee not found');
      }

      // Validate camporee is active
      if (!camporee.active) {
        throw new BadRequestException('Camporee is not active');
      }

      // 2. Validate user exists
      const user = await tx.users.findUnique({
        where: { user_id: dto.user_id },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      // 3. Check for duplicate registration
      const existingRegistration = await tx.camporee_members.findFirst({
        where: {
          camporee_id: camporeeId,
          user_id: dto.user_id,
          active: true,
        },
      });

      if (existingRegistration) {
        throw new BadRequestException(
          'User is already registered for this camporee',
        );
      }

      // 4. If insurance_id is provided, validate insurance
      if (dto.insurance_id) {
        const insurance = await tx.member_insurances.findUnique({
          where: { insurance_id: dto.insurance_id },
        });

        // Validate insurance exists
        if (!insurance) {
          throw new BadRequestException('Insurance not found');
        }

        // Validate insurance belongs to the user
        if (insurance.user_id !== dto.user_id) {
          throw new BadRequestException(
            'Insurance does not belong to this user',
          );
        }

        // Validate insurance type is CAMPOREE
        if (insurance.insurance_type !== 'CAMPOREE') {
          throw new BadRequestException('Insurance type must be CAMPOREE');
        }

        // Validate insurance is not expired before camporee ends
        if (insurance.end_date < camporee.end_date) {
          throw new BadRequestException(
            'Insurance expires before camporee ends',
          );
        }

        // Validate insurance is active
        if (!insurance.active) {
          throw new BadRequestException('Insurance is not active');
        }
      }

      // 5. Create registration in camporee_members
      const member = await tx.camporee_members.create({
        data: {
          camporee_id: camporeeId,
          camporee_type: dto.camporee_type,
          user_id: dto.user_id,
          club_name: dto.club_name,
          insurance_verified: !!dto.insurance_id,
          insurance_id: dto.insurance_id,
          active: true,
        },
        include: {
          users: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
              email: true,
              user_image: true,
            },
          },
          insurance: {
            select: {
              insurance_id: true,
              insurance_type: true,
              policy_number: true,
              provider: true,
              start_date: true,
              end_date: true,
            },
          },
        },
      });

      return member;
    });
  }

  /**
   * Get all members registered for a camporee
   * @param camporeeId - The local_camporee_id
   */
  async getMembers(camporeeId: number) {
    // Validate camporee exists
    await this.findOne(camporeeId);

    return await this.prisma.camporee_members.findMany({
      where: {
        camporee_id: camporeeId,
        active: true,
      },
      include: {
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
            email: true,
            user_image: true,
            birthday: true,
          },
        },
        insurance: {
          select: {
            insurance_id: true,
            insurance_type: true,
            policy_number: true,
            provider: true,
            start_date: true,
            end_date: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Remove a member from a camporee (soft delete)
   * @param camporeeId - The local_camporee_id
   * @param userId - The user_id to remove
   */
  async removeMember(camporeeId: number, userId: string) {
    // Validate camporee exists
    await this.findOne(camporeeId);

    // Find the registration
    const registration = await this.prisma.camporee_members.findFirst({
      where: {
        camporee_id: camporeeId,
        user_id: userId,
        active: true,
      },
    });

    if (!registration) {
      throw new NotFoundException(
        `Member with user ID ${userId} not found in camporee ${camporeeId}`,
      );
    }

    // Soft delete the registration
    return await this.prisma.camporee_members.update({
      where: {
        camporee_member_id: registration.camporee_member_id,
      },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });
  }

  // ========================================
  // LEGACY METHODS (for controller compatibility)
  // ========================================

  /**
   * Legacy method - redirects to registerMember
   * @deprecated Use registerMember instead
   */
  async registerParticipants(
    camporeeId: number,
    dto: RegisterMemberDto,
    registeredBy: string,
  ) {
    return this.registerMember(camporeeId, dto);
  }

  /**
   * Legacy method - redirects to getMembers with pagination
   * @deprecated Use getMembers instead
   */
  async getParticipants(
    camporeeId: number,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<any>> {
    const members = await this.getMembers(camporeeId);

    // Apply pagination manually
    const skip = pagination?.skip ?? 0;
    const take = pagination?.take ?? 20;
    const paginatedMembers = members.slice(skip, skip + take);

    return createPaginatedResult(
      paginatedMembers,
      members.length,
      pagination ?? new PaginationDto(),
    );
  }
}
