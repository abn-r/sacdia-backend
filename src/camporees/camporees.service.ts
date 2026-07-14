import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import { UnionMembersListQueryDto } from './dto/union-members-list-query.dto';
import { CamporeeMembersListQueryDto } from './dto/camporee-members-list-query.dto';
import {
  CamporeeSectionRegistrationDto,
  type SectionRegistrationDisposition,
  type SectionRegistrationStatus,
} from './dto/camporee-section-registration.dto';
import { CreateCamporeeDto } from './dto/create-camporee.dto';
import { UpdateCamporeeDto } from './dto/update-camporee.dto';
import { CreateUnionCamporeeDto } from './dto/create-union-camporee.dto';
import { UpdateUnionCamporeeDto } from './dto/update-union-camporee.dto';
import { RegisterMemberDto } from './dto/register-member.dto';
import { EnrollClubDto } from './dto/enroll-club.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { buildPartialUpdate } from '../common/utils/dto.utils';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import type {
  AuthorizationSnapshot,
  ClubAuthorizationGrant,
  GlobalAuthorizationGrant,
} from '../common/services/authorization-context.service';
import { AchievementsService } from '../achievements/achievements.service';
import pLimit from 'p-limit';
import {
  CamporeeLifecyclePolicy,
  type CamporeeLifecycleContext,
} from './policies';

// Module-level concurrency cap for applySignedPrivateUrls fan-out.
// Phase 1 (USER_PROFILES public bucket) makes the call synchronous, so
// this limiter is a no-op in practice. Kept as defense-in-depth for
// future regressions where any other private bucket might re-enter the
// same code path.
export const PROFILE_URL_LIMITER = pLimit(20);

type CamporeeRegistrationDb = Pick<
  Prisma.TransactionClient,
  'local_camporees' | 'club_sections' | 'camporee_clubs' | '$queryRaw'
>;

@Injectable()
export class CamporeesService {
  private readonly logger = new Logger(CamporeesService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;
  private static readonly ELIGIBLE_CAMPOREE_INSURANCE_TYPES = [
    'CAMPOREE',
    'GENERAL_ACTIVITIES',
  ] as const;
  private static readonly DEFAULT_CAMPOREE_TIMEZONE = 'America/Mexico_City';

  private static isEligibleCamporeeInsuranceType(insuranceType: string) {
    return (
      CamporeesService.ELIGIBLE_CAMPOREE_INSURANCE_TYPES as readonly string[]
    ).includes(insuranceType);
  }

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly notificationsService: NotificationsService,
    private readonly achievementsService: AchievementsService,
    private readonly camporeeLifecyclePolicy: CamporeeLifecyclePolicy,
  ) {}

  // Task 3 implements the contextual GET contract.
  async getActiveSectionRegistration(
    camporeeId: number,
    actorId: string,
    authorization: AuthorizationSnapshot,
  ): Promise<CamporeeSectionRegistrationDto> {
    void actorId;
    const activeGrant = this.resolveActiveClubGrant(authorization);
    const { camporee, section } =
      await this.loadActiveSectionRegistrationContext(
        this.prisma,
        camporeeId,
        activeGrant,
      );

    const enrollment = await this.prisma.camporee_clubs.findFirst({
      where: {
        camporee_id: camporeeId,
        club_section_id: section.club_section_id,
        active: true,
      },
      select: {
        camporee_club_id: true,
        status: true,
        created_at: true,
        registrar: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
    });

    const disposition = this.resolveClubRegistrationDisposition(camporee);
    const clubTypeIncluded =
      section?.active === true &&
      section.club_types.active === true &&
      this.isClubTypeIncludedInCamporee(section.club_type_id, camporee);

    return this.mapActiveSectionRegistration({
      camporeeId,
      activeGrant,
      section,
      enrollment,
      disposition,
      clubTypeIncluded,
    });
  }

  async registerActiveSection(
    camporeeId: number,
    actorId: string,
    authorization: AuthorizationSnapshot,
  ): Promise<CamporeeSectionRegistrationDto> {
    const activeGrant = this.resolveActiveClubGrant(authorization);

    // Permissions on the grant are not enough: only the exact active director
    // role may create an enrollment for its own section.
    if (activeGrant.role_name !== 'director') {
      throw new AppForbiddenException(
        ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
      );
    }

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        await this.lockLocalCamporeeRegistrationGate(
          tx,
          camporeeId,
          activeGrant,
        );
        const { camporee, section } =
          await this.loadActiveSectionRegistrationContext(
            tx,
            camporeeId,
            activeGrant,
          );
        const disposition = this.resolveClubRegistrationDisposition(camporee);

        if (
          !section.club_types.active ||
          !this.isClubTypeIncludedInCamporee(section.club_type_id, camporee)
        ) {
          throw new AppForbiddenException(
            ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
          );
        }

        const existingEnrollment = await this.findActiveSectionEnrollment(
          tx,
          camporeeId,
          section.club_section_id,
        );
        if (existingEnrollment) {
          return {
            camporee,
            section,
            enrollment: existingEnrollment,
            disposition,
            created: false,
          };
        }

        if (
          disposition === 'not_open_yet' ||
          disposition === 'manually_frozen'
        ) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_CLUB_REGISTRATION_CLOSED,
          );
        }

        const enrollment = await tx.camporee_clubs.create({
          data: {
            camporee_id: camporeeId,
            camporee_type: 'local',
            club_section_id: section.club_section_id,
            club_id: section.clubs.club_id,
            registered_by: actorId,
            status:
              disposition === 'late_approval_required'
                ? 'pending_approval'
                : 'registered',
            active: true,
          },
          select: {
            camporee_club_id: true,
            status: true,
            created_at: true,
            registrar: {
              select: {
                user_id: true,
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        });

        return {
          camporee,
          section,
          enrollment,
          disposition,
          created: true,
        };
      });

      if (outcome.created && outcome.disposition === 'late_approval_required') {
        this.notifyLateActiveSectionRegistration(
          camporeeId,
          outcome.camporee.local_field_id,
        );
      }

      return this.mapActiveSectionRegistration({
        camporeeId,
        activeGrant,
        section: outcome.section,
        enrollment: outcome.enrollment,
        disposition: outcome.disposition,
        clubTypeIncluded: true,
      });
    } catch (error) {
      if (!this.isLocalActiveSectionUniqueConstraintError(error)) {
        throw error;
      }

      // PostgreSQL aborts a transaction after a unique violation. Recover the
      // winner through the root client, outside the invalid transaction.
      const { camporee, section } =
        await this.loadActiveSectionRegistrationContext(
          this.prisma,
          camporeeId,
          activeGrant,
        );
      if (
        !section.club_types.active ||
        !this.isClubTypeIncludedInCamporee(section.club_type_id, camporee)
      ) {
        throw new AppForbiddenException(
          ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
        );
      }

      const winner = await this.findActiveSectionEnrollment(
        this.prisma,
        camporeeId,
        section.club_section_id,
      );
      if (!winner) {
        throw error;
      }

      return this.mapActiveSectionRegistration({
        camporeeId,
        activeGrant,
        section,
        enrollment: winner,
        disposition: this.resolveClubRegistrationDisposition(camporee),
        clubTypeIncluded: true,
      });
    }
  }

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
    authorization?: AuthorizationSnapshot,
  ): Promise<PaginatedResult<any>> {
    const where: any = {};

    if (filters?.active !== undefined) {
      where.active = filters.active;
    }

    this.applyCamporeeScope(where, authorization);

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
      throw new AppNotFoundException(ErrorCode.CAMPOREE_NOT_FOUND, {
        id: camporeeId,
      });
    }

    return camporee;
  }

  /**
   * Create a new local camporee
   * @param dto - Create camporee DTO
   * @param createdBy - User ID creating the camporee (not used in schema but kept for future use)
   */
  async create(
    dto: CreateCamporeeDto,
    createdBy: string,
    authorization?: AuthorizationSnapshot,
  ) {
    this.assertTimezoneInput(dto.timezone);
    await this.assertCanManageLocalField(dto.local_field_id, authorization);
    const lifecycle = this.lifecycleContextFromDto(dto);
    this.camporeeLifecyclePolicy.assertDateOrder(lifecycle);

    // Get the active ecclesiastical year
    const activeYear = await this.prisma.ecclesiastical_years.findFirst({
      where: { active: true },
      orderBy: { start_date: 'desc' },
    });

    if (!activeYear) {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_YEAR_NOT_ACTIVE);
    }

    // Validate local field exists
    const localField = await this.prisma.local_fields.findUnique({
      where: { local_field_id: dto.local_field_id },
    });

    if (!localField) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_LOCAL_FIELD_NOT_FOUND, {
        id: dto.local_field_id,
      });
    }

    return this.prisma.local_camporees.create({
      data: {
        name: dto.name,
        description: dto.description,
        start_date: new Date(dto.start_date),
        end_date: new Date(dto.end_date),
        timezone: lifecycle.timezone,
        ...(typeof dto.timezone === 'string'
          ? {
              timezone_verified_at: new Date(),
              timezone_verified_by: createdBy,
            }
          : {}),
        club_registration_opens_at: dto.club_registration_opens_at
          ? new Date(dto.club_registration_opens_at)
          : null,
        club_registration_deadline: dto.club_registration_deadline
          ? new Date(dto.club_registration_deadline)
          : null,
        member_registration_deadline: dto.member_registration_deadline
          ? new Date(dto.member_registration_deadline)
          : null,
        payment_deadline: dto.payment_deadline
          ? new Date(dto.payment_deadline)
          : null,
        agenda_visible_from: dto.agenda_visible_from
          ? new Date(dto.agenda_visible_from)
          : null,
        local_field_id: dto.local_field_id,
        includes_adventurers: dto.includes_adventurers,
        includes_pathfinders: dto.includes_pathfinders,
        includes_master_guides: dto.includes_master_guides,
        local_camporee_place: dto.local_camporee_place,
        lat: dto.lat,
        long: dto.long,
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
  async update(
    camporeeId: number,
    dto: UpdateCamporeeDto,
    actorUserId?: string,
  ) {
    this.assertTimezoneInput(dto.timezone);
    const existing = await this.findOne(camporeeId);
    this.camporeeLifecyclePolicy.assertDateOrder(
      this.lifecycleContextFromDto(dto, existing),
    );

    // Build update object with only defined fields, converting date fields
    const updateData = {
      ...buildPartialUpdate(dto, [
        'start_date',
        'end_date',
        'club_registration_opens_at',
        'club_registration_deadline',
        'member_registration_deadline',
        'payment_deadline',
        'agenda_visible_from',
      ]),
      ...(typeof dto.timezone === 'string' && actorUserId
        ? {
            timezone_verified_at: new Date(),
            timezone_verified_by: actorUserId,
          }
        : {}),
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
  // CRUD FOR UNION_CAMPOREES
  // ========================================

  /**
   * Find all union camporees with pagination and filters
   * @param filters - Filter by union_id, active status, or ecclesiastical year
   * @param pagination - Pagination parameters
   * @param authorization - Authorization snapshot for scoping
   */
  async findAllUnion(
    filters?: { union_id?: number; active?: boolean; year?: number },
    pagination?: PaginationDto,
    authorization?: AuthorizationSnapshot,
  ): Promise<PaginatedResult<any>> {
    const where: any = {};

    if (filters?.active !== undefined) {
      where.active = filters.active;
    }

    if (filters?.union_id !== undefined) {
      where.union_id = filters.union_id;
    }

    if (filters?.year !== undefined) {
      where.ecclesiastical_year = filters.year;
    }

    this.applyUnionCamporeeScope(where, authorization);

    const [data, total] = await Promise.all([
      this.prisma.union_camporees.findMany({
        where,
        include: {
          unions: {
            select: {
              union_id: true,
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
          union_camporee_local_fields: {
            where: { active: true },
            include: {
              local_fields: {
                select: {
                  local_field_id: true,
                  name: true,
                  abbreviation: true,
                },
              },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 20,
      }),
      this.prisma.union_camporees.count({ where }),
    ]);

    return createPaginatedResult(
      data,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  /**
   * Find a single union camporee by ID with local fields
   * @param camporeeId - The union_camporee_id
   */
  async findOneUnion(camporeeId: number) {
    const camporee = await this.prisma.union_camporees.findUnique({
      where: { union_camporee_id: camporeeId },
      include: {
        unions: {
          select: {
            union_id: true,
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
        union_camporee_local_fields: {
          where: { active: true },
          include: {
            local_fields: {
              select: {
                local_field_id: true,
                name: true,
                abbreviation: true,
              },
            },
          },
        },
      },
    });

    if (!camporee) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND,
        { id: camporeeId },
      );
    }

    return camporee;
  }

  /**
   * Create a new union camporee with optional local field associations
   * @param dto - Create union camporee DTO
   * @param createdBy - User ID creating the camporee
   * @param authorization - Authorization snapshot for scope validation
   */
  async createUnion(
    dto: CreateUnionCamporeeDto,
    createdBy: string,
    authorization?: AuthorizationSnapshot,
  ) {
    this.assertTimezoneInput(dto.timezone);
    await this.assertCanManageUnion(dto.union_id, authorization);
    const lifecycle = this.lifecycleContextFromDto(dto);
    this.camporeeLifecyclePolicy.assertDateOrder(lifecycle);

    // Get the active ecclesiastical year
    const activeYear = await this.prisma.ecclesiastical_years.findFirst({
      where: { active: true },
      orderBy: { start_date: 'desc' },
    });

    if (!activeYear) {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_YEAR_NOT_ACTIVE);
    }

    // Validate union exists
    const union = await this.prisma.unions.findUnique({
      where: { union_id: dto.union_id },
    });

    if (!union) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_UNION_NOT_FOUND, {
        id: dto.union_id,
      });
    }

    // Validate local fields belong to the union (if provided)
    if (dto.local_field_ids?.length) {
      const localFields = await this.prisma.local_fields.findMany({
        where: {
          local_field_id: { in: dto.local_field_ids },
          union_id: dto.union_id,
        },
      });

      if (localFields.length !== dto.local_field_ids.length) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_LOCAL_FIELD_INVALID,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Create the union camporee
      const camporee = await tx.union_camporees.create({
        data: {
          name: dto.name,
          description: dto.description,
          start_date: new Date(dto.start_date),
          end_date: new Date(dto.end_date),
          timezone: lifecycle.timezone,
          ...(typeof dto.timezone === 'string'
            ? {
                timezone_verified_at: new Date(),
                timezone_verified_by: createdBy,
              }
            : {}),
          club_registration_opens_at: dto.club_registration_opens_at
            ? new Date(dto.club_registration_opens_at)
            : null,
          club_registration_deadline: dto.club_registration_deadline
            ? new Date(dto.club_registration_deadline)
            : null,
          member_registration_deadline: dto.member_registration_deadline
            ? new Date(dto.member_registration_deadline)
            : null,
          payment_deadline: dto.payment_deadline
            ? new Date(dto.payment_deadline)
            : null,
          agenda_visible_from: dto.agenda_visible_from
            ? new Date(dto.agenda_visible_from)
            : null,
          union_id: dto.union_id,
          includes_adventurers: dto.includes_adventurers,
          includes_pathfinders: dto.includes_pathfinders,
          includes_master_guides: dto.includes_master_guides,
          union_camporee_place: dto.union_camporee_place,
          lat: dto.lat,
          long: dto.long,
          registration_cost: dto.registration_cost,
          ecclesiastical_year: activeYear.year_id,
          active: true,
        },
      });

      // Create local field associations if provided
      if (dto.local_field_ids?.length) {
        await tx.union_camporee_local_fields.createMany({
          data: dto.local_field_ids.map((localFieldId) => ({
            union_camporee_lf_id: camporee.union_camporee_id,
            local_field_id: localFieldId,
            active: true,
          })),
        });
      }

      // Return with relations
      return tx.union_camporees.findUnique({
        where: { union_camporee_id: camporee.union_camporee_id },
        include: {
          unions: {
            select: {
              union_id: true,
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
          union_camporee_local_fields: {
            where: { active: true },
            include: {
              local_fields: {
                select: {
                  local_field_id: true,
                  name: true,
                  abbreviation: true,
                },
              },
            },
          },
        },
      });
    });
  }

  /**
   * Update a union camporee
   * @param camporeeId - The union_camporee_id
   * @param dto - Update union camporee DTO
   */
  async updateUnion(
    camporeeId: number,
    dto: UpdateUnionCamporeeDto,
    actorUserId?: string,
  ) {
    this.assertTimezoneInput(dto.timezone);
    const existing = await this.findOneUnion(camporeeId);
    this.camporeeLifecyclePolicy.assertDateOrder(
      this.lifecycleContextFromDto(dto, existing),
    );

    const { local_field_ids, ...fieldsToUpdate } = dto;

    // Build update object with only defined fields, converting date fields
    const updateData = {
      ...buildPartialUpdate(fieldsToUpdate, [
        'start_date',
        'end_date',
        'club_registration_opens_at',
        'club_registration_deadline',
        'member_registration_deadline',
        'payment_deadline',
        'agenda_visible_from',
      ]),
      ...(typeof dto.timezone === 'string' && actorUserId
        ? {
            timezone_verified_at: new Date(),
            timezone_verified_by: actorUserId,
          }
        : {}),
      modified_at: new Date(),
    };

    return this.prisma.$transaction(async (tx) => {
      // Update the camporee itself
      const camporee = await tx.union_camporees.update({
        where: { union_camporee_id: camporeeId },
        data: updateData,
      });

      // Update local field associations if provided
      if (local_field_ids !== undefined) {
        // Validate local fields belong to the union
        if (local_field_ids.length) {
          const localFields = await tx.local_fields.findMany({
            where: {
              local_field_id: { in: local_field_ids },
              union_id: camporee.union_id,
            },
          });

          if (localFields.length !== local_field_ids.length) {
            throw new AppBadRequestException(
              ErrorCode.CAMPOREE_LOCAL_FIELD_INVALID,
            );
          }
        }

        // Soft-delete existing associations
        await tx.union_camporee_local_fields.updateMany({
          where: { union_camporee_lf_id: camporeeId },
          data: { active: false, modified_at: new Date() },
        });

        // Create new associations
        if (local_field_ids.length) {
          for (const localFieldId of local_field_ids) {
            await tx.union_camporee_local_fields.upsert({
              where: {
                union_camporee_lf_id_local_field_id: {
                  union_camporee_lf_id: camporeeId,
                  local_field_id: localFieldId,
                },
              },
              update: { active: true, modified_at: new Date() },
              create: {
                union_camporee_lf_id: camporeeId,
                local_field_id: localFieldId,
                active: true,
              },
            });
          }
        }
      }

      // Return with relations
      return tx.union_camporees.findUnique({
        where: { union_camporee_id: camporeeId },
        include: {
          unions: {
            select: {
              union_id: true,
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
          union_camporee_local_fields: {
            where: { active: true },
            include: {
              local_fields: {
                select: {
                  local_field_id: true,
                  name: true,
                  abbreviation: true,
                },
              },
            },
          },
        },
      });
    });
  }

  /**
   * Soft delete a union camporee (set active = false)
   * @param camporeeId - The union_camporee_id
   */
  async removeUnion(camporeeId: number) {
    await this.findOneUnion(camporeeId);

    return this.prisma.union_camporees.update({
      where: { union_camporee_id: camporeeId },
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
    let isLate = false;
    let camporeeLocalFieldId: number | null = null;
    let camporeeName: string | null = null;

    const member = await this.prisma.$transaction(async (tx) => {
      // 1. Validate camporee exists
      const camporee = await tx.local_camporees.findUnique({
        where: { local_camporee_id: camporeeId },
      });

      if (!camporee) {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_NOT_FOUND, {
          id: camporeeId,
        });
      }

      // Validate camporee is active
      if (!camporee.active) {
        throw new AppBadRequestException(ErrorCode.CAMPOREE_NOT_ACTIVE);
      }

      isLate = this.camporeeLifecyclePolicy.isAfterDeadline(
        camporee.member_registration_deadline,
      );
      camporeeLocalFieldId = camporee.local_field_id;
      camporeeName = camporee.name;

      // 2. Validate user exists
      const user = await tx.users.findUnique({
        where: { user_id: dto.user_id },
      });

      if (!user) {
        throw new AppBadRequestException(ErrorCode.CAMPOREE_USER_NOT_FOUND);
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
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_MEMBER_ALREADY_REGISTERED,
        );
      }

      // 4. If insurance_id is provided, validate insurance
      if (dto.insurance_id) {
        const insurance = await tx.member_insurances.findUnique({
          where: { insurance_id: dto.insurance_id },
        });

        // Validate insurance exists
        if (!insurance) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_INSURANCE_NOT_FOUND,
          );
        }

        // Validate insurance belongs to the user
        if (insurance.user_id !== dto.user_id) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_INSURANCE_NOT_OWNER,
          );
        }

        // Validate insurance type is eligible for camporees
        if (
          !CamporeesService.isEligibleCamporeeInsuranceType(
            insurance.insurance_type,
          )
        ) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_INSURANCE_TYPE_INVALID,
          );
        }

        // Validate insurance is not expired before camporee ends
        if (insurance.end_date < camporee.end_date) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_INSURANCE_EXPIRED,
          );
        }

        // Validate insurance is active
        if (!insurance.active) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_INSURANCE_NOT_ACTIVE,
          );
        }
      }

      // 5. Create registration in camporee_members
      const member = await tx.camporee_members.create({
        data: {
          camporee_id: camporeeId,
          camporee_type: 'local',
          user_id: dto.user_id,
          club_name: dto.club_name,
          insurance_verified: !!dto.insurance_id,
          insurance_id: dto.insurance_id,
          status: isLate ? 'pending_approval' : 'registered',
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

    if (isLate && camporeeLocalFieldId) {
      setImmediate(() => {
        void this.notificationsService.sendToGlobalRole(
          ['director-lf', 'assistant-lf'],
          'Inscripción tardía por revisar',
          `Un miembro se inscribió fuera de plazo al camporee y necesita revisión`,
          { camporeeId: String(camporeeId), type: 'member_enrollment' },
          camporeeLocalFieldId ?? undefined,
          'camporees:late_enrollment',
        );
      });
    }

    try {
      await this.achievementsService.emitEvent({
        userId: dto.user_id,
        eventType: 'camporee.participated',
        payload: {
          camporee_id: camporeeId,
          camporee_name: camporeeName,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit achievement event: ${(error as Error).message}`,
      );
    }

    return this.applySignedPrivateUrls(member);
  }

  /**
   * Get all members registered for a camporee (paginated)
   * @param camporeeId - The local_camporee_id
   * @param status - Optional status filter. Defaults to excluding pending_approval
   * @param pagination - Pagination parameters (page, limit). Default: page=1, limit=50
   */
  async getMembers(
    camporeeId: number,
    status?: string,
    pagination?: CamporeeMembersListQueryDto,
  ): Promise<PaginatedResult<any>> {
    // Validate camporee exists
    await this.findOne(camporeeId);

    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 50;
    const skip = (page - 1) * limit;

    const where = {
      camporee_id: camporeeId,
      active: true,
      ...(status ? { status } : { status: { not: 'pending_approval' } }),
    };

    const include = {
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
    };

    const [members, total] = await this.prisma.$transaction([
      this.prisma.camporee_members.findMany({
        where,
        include,
        orderBy: { created_at: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.camporee_members.count({ where }),
    ]);

    const data = await Promise.all(
      members.map((member) =>
        PROFILE_URL_LIMITER(() => this.applySignedPrivateUrls(member)),
      ),
    );

    const paginationDto = Object.assign(new CamporeeMembersListQueryDto(), {
      page,
      limit,
    });
    return createPaginatedResult(data, total, paginationDto);
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
      throw new AppNotFoundException(ErrorCode.CAMPOREE_MEMBER_NOT_FOUND, {
        id: userId,
      });
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

  private async countActiveEnrolledClubSections(where: {
    camporee_id?: number;
    union_camporee_id?: number;
  }): Promise<number> {
    return this.prisma.camporee_clubs.count({
      where: {
        ...where,
        active: true,
        club_section_id: { not: null },
        status: { in: ['registered', 'approved'] },
      },
    });
  }

  private async countActiveScoringArtifacts(where: {
    local_camporee_id?: number;
    union_camporee_id?: number;
  }): Promise<number> {
    const [results, assignments] = await Promise.all([
      this.prisma.camporee_event_section_results.count({
        where: {
          active: true,
          camporee_event: { ...where, active: true },
        },
      }),
      this.prisma.camporee_event_judge_assignments.count({
        where: {
          active: true,
          camporee_event: { ...where, active: true },
        },
      }),
    ]);

    return results + assignments;
  }

  async closeLocalCamporeeClubRegistration(
    camporeeId: number,
    actorUserId: string,
  ) {
    const camporee = await (this.prisma as any).local_camporees.findUnique({
      where: { local_camporee_id: camporeeId },
    });

    if (!camporee) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_NOT_FOUND, {
        id: camporeeId,
      });
    }
    if (!camporee.active) {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_NOT_ACTIVE);
    }
    if (camporee.club_registration_closed_at) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_CLUB_REGISTRATION_CLOSED,
      );
    }

    const enrolledCount = await this.countActiveEnrolledClubSections({
      camporee_id: camporeeId,
    });
    if (enrolledCount === 0) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_CLUB_REGISTRATION_NO_ENROLLED_CLUBS,
      );
    }

    return (this.prisma as any).local_camporees.update({
      where: { local_camporee_id: camporeeId },
      data: {
        club_registration_closed_at: new Date(),
        club_registration_closed_by: actorUserId,
        modified_at: new Date(),
      },
    });
  }

  async reopenLocalCamporeeClubRegistration(
    camporeeId: number,
    _actorUserId: string,
  ) {
    await this.findOne(camporeeId);
    const scoringArtifacts = await this.countActiveScoringArtifacts({
      local_camporee_id: camporeeId,
    });
    if (scoringArtifacts > 0) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_CLUB_REGISTRATION_REOPEN_BLOCKED,
      );
    }

    return (this.prisma as any).local_camporees.update({
      where: { local_camporee_id: camporeeId },
      data: {
        club_registration_closed_at: null,
        club_registration_closed_by: null,
        modified_at: new Date(),
      },
    });
  }

  async closeUnionCamporeeClubRegistration(
    camporeeId: number,
    actorUserId: string,
  ) {
    const camporee = await (this.prisma as any).union_camporees.findUnique({
      where: { union_camporee_id: camporeeId },
    });

    if (!camporee) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND,
        { id: camporeeId },
      );
    }
    if (!camporee.active) {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_NOT_ACTIVE);
    }
    if (camporee.club_registration_closed_at) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_CLUB_REGISTRATION_CLOSED,
      );
    }

    const enrolledCount = await this.countActiveEnrolledClubSections({
      union_camporee_id: camporeeId,
    });
    if (enrolledCount === 0) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_CLUB_REGISTRATION_NO_ENROLLED_CLUBS,
      );
    }

    return (this.prisma as any).union_camporees.update({
      where: { union_camporee_id: camporeeId },
      data: {
        club_registration_closed_at: new Date(),
        club_registration_closed_by: actorUserId,
        modified_at: new Date(),
      },
    });
  }

  async reopenUnionCamporeeClubRegistration(
    camporeeId: number,
    _actorUserId: string,
  ) {
    await this.findOneUnion(camporeeId);
    const scoringArtifacts = await this.countActiveScoringArtifacts({
      union_camporee_id: camporeeId,
    });
    if (scoringArtifacts > 0) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_CLUB_REGISTRATION_REOPEN_BLOCKED,
      );
    }

    return (this.prisma as any).union_camporees.update({
      where: { union_camporee_id: camporeeId },
      data: {
        club_registration_closed_at: null,
        club_registration_closed_by: null,
        modified_at: new Date(),
      },
    });
  }

  // ========================================
  // CLUB ENROLLMENT
  // ========================================

  /**
   * Enroll a club section in a camporee
   * @param camporeeId - The local_camporee_id
   * @param dto - Enroll club DTO
   * @param registeredBy - User ID performing the enrollment
   */
  async enrollClub(
    camporeeId: number,
    dto: EnrollClubDto,
    registeredBy: string,
  ) {
    let isLate = false;
    let camporeeLocalFieldId: number | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Validate camporee exists and is active
      const camporee = await tx.local_camporees.findUnique({
        where: { local_camporee_id: camporeeId },
      });

      if (!camporee) {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_NOT_FOUND, {
          id: camporeeId,
        });
      }

      if (!camporee.active) {
        throw new AppBadRequestException(ErrorCode.CAMPOREE_NOT_ACTIVE);
      }
      const clubRegistrationDisposition =
        this.resolveClubRegistrationDisposition(camporee);
      if (
        clubRegistrationDisposition === 'manually_frozen' ||
        clubRegistrationDisposition === 'not_open_yet'
      ) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_CLUB_REGISTRATION_CLOSED,
        );
      }

      isLate = clubRegistrationDisposition === 'late_approval_required';
      camporeeLocalFieldId = camporee.local_field_id;

      // 2. Validate club section exists
      const clubSection = await tx.club_sections.findUnique({
        where: { club_section_id: dto.club_section_id },
        include: {
          club_types: { select: { club_type_id: true, name: true } },
          clubs: { select: { club_id: true, name: true } },
        },
      });

      if (!clubSection) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_CLUB_SECTION_NOT_FOUND,
          { id: dto.club_section_id },
        );
      }

      // 3. Check for duplicate enrollment
      const existingEnrollment = await tx.camporee_clubs.findFirst({
        where: {
          camporee_id: camporeeId,
          club_section_id: dto.club_section_id,
          active: true,
        },
      });

      if (existingEnrollment) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_CLUB_ALREADY_ENROLLED,
        );
      }

      // 4. Create enrollment
      return tx.camporee_clubs.create({
        data: {
          camporee_id: camporeeId,
          camporee_type: 'local',
          club_section_id: dto.club_section_id,
          club_id: clubSection.main_club_id,
          status: isLate ? 'pending_approval' : 'registered',
          registered_by: registeredBy,
          active: true,
        },
        include: {
          club_sections: {
            include: {
              club_types: { select: { club_type_id: true, name: true } },
              clubs: { select: { club_id: true, name: true } },
            },
          },
          registrar: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
        },
      });
    });

    if (isLate && camporeeLocalFieldId) {
      setImmediate(() => {
        void this.notificationsService.sendToGlobalRole(
          ['director-lf', 'assistant-lf'],
          'Inscripción tardía por revisar',
          `Un club se inscribió fuera de plazo al camporee y necesita revisión`,
          { camporeeId: String(camporeeId), type: 'club_enrollment' },
          camporeeLocalFieldId ?? undefined,
          'camporees:late_enrollment',
        );
      });
    }

    return result;
  }

  /**
   * Get all enrolled clubs for a camporee
   * @param camporeeId - The local_camporee_id
   * @param status - Optional status filter. Defaults to excluding pending_approval
   */
  async getEnrolledClubs(camporeeId: number, status?: string) {
    // Validate camporee exists
    await this.findOne(camporeeId);

    // Safety cap: a single local camporee is not expected to have more than
    // 500 enrolled clubs. Paginate at the controller level if needed.
    return this.prisma.camporee_clubs.findMany({
      where: {
        camporee_id: camporeeId,
        active: true,
        ...(status ? { status } : { status: { not: 'pending_approval' } }),
      },
      include: {
        club_sections: {
          include: {
            club_types: { select: { club_type_id: true, name: true } },
            clubs: { select: { club_id: true, name: true } },
          },
        },
        registrar: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
      take: 500,
    });
  }

  /**
   * Cancel a club enrollment (soft delete)
   * @param camporeeId - The local_camporee_id
   * @param camporeeClubId - The camporee_club_id to cancel
   */
  async cancelClubEnrollment(camporeeId: number, camporeeClubId: number) {
    // Validate camporee exists
    await this.findOne(camporeeId);

    const enrollment = await this.prisma.camporee_clubs.findFirst({
      where: {
        camporee_club_id: camporeeClubId,
        camporee_id: camporeeId,
        active: true,
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_CLUB_ENROLLMENT_NOT_FOUND,
        { id: camporeeClubId },
      );
    }

    return this.prisma.camporee_clubs.update({
      where: { camporee_club_id: camporeeClubId },
      data: {
        active: false,
        status: 'cancelled',
        modified_at: new Date(),
      },
    });
  }

  // ========================================
  // PAYMENTS
  // ========================================

  /**
   * Register a payment for a camporee member
   * @param camporeeId - The local_camporee_id
   * @param memberId - The camporee_member_id
   * @param dto - Create payment DTO
   * @param registeredBy - User ID performing the registration
   */
  async createPayment(
    camporeeId: number,
    memberId: number,
    dto: CreatePaymentDto,
    registeredBy: string,
  ) {
    let isLate = false;
    let camporeeLocalFieldId: number | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Validate camporee exists
      const camporee = await tx.local_camporees.findUnique({
        where: { local_camporee_id: camporeeId },
      });

      if (!camporee) {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_NOT_FOUND, {
          id: camporeeId,
        });
      }

      isLate = this.camporeeLifecyclePolicy.isAfterDeadline(
        camporee.payment_deadline,
      );
      camporeeLocalFieldId = camporee.local_field_id;

      // 2. Validate member is registered in this camporee
      const member = await tx.camporee_members.findFirst({
        where: {
          camporee_member_id: memberId,
          camporee_id: camporeeId,
          active: true,
        },
      });

      if (!member) {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_MEMBER_NOT_FOUND, {
          id: memberId,
        });
      }

      // 3. Create payment
      return tx.camporee_payments.create({
        data: {
          camporee_member_id: memberId,
          amount: dto.amount,
          payment_type: dto.payment_type,
          reference: dto.reference,
          notes: dto.notes,
          registered_by: registeredBy,
          paid_at: new Date(dto.paid_at),
          status: isLate ? 'pending_approval' : 'registered',
        },
        include: {
          camporee_member: {
            select: {
              camporee_member_id: true,
              camporee_id: true,
              user_id: true,
              users: {
                select: {
                  name: true,
                  paternal_last_name: true,
                  maternal_last_name: true,
                },
              },
            },
          },
          registrar: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
        },
      });
    });

    if (isLate && camporeeLocalFieldId) {
      setImmediate(() => {
        void this.notificationsService.sendToGlobalRole(
          ['director-lf', 'assistant-lf'],
          'Pago tardío por revisar',
          `Se registró un pago fuera de plazo y necesita revisión`,
          { camporeeId: String(camporeeId), type: 'payment' },
          camporeeLocalFieldId ?? undefined,
          'camporees:late_payment',
        );
      });
    }

    return result;
  }

  /**
   * Get all payments for a specific camporee member
   * @param camporeeId - The local_camporee_id
   * @param memberId - The camporee_member_id
   * @param status - Optional status filter. Defaults to excluding pending_approval
   */
  async getMemberPayments(
    camporeeId: number,
    memberId: number,
    status?: string,
  ) {
    // Validate camporee exists
    await this.findOne(camporeeId);

    // Validate member belongs to this camporee
    const member = await this.prisma.camporee_members.findFirst({
      where: {
        camporee_member_id: memberId,
        camporee_id: camporeeId,
      },
    });

    if (!member) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_MEMBER_NOT_FOUND, {
        id: memberId,
      });
    }

    // Safety cap: a single member is unlikely to have more than 200 payments.
    return this.prisma.camporee_payments.findMany({
      where: {
        camporee_member_id: memberId,
        ...(status ? { status } : { status: { not: 'pending_approval' } }),
      },
      include: {
        camporee_member: {
          select: {
            camporee_member_id: true,
            camporee_id: true,
            user_id: true,
          },
        },
        registrar: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: { paid_at: 'desc' },
      take: 200,
    });
  }

  /**
   * Get all payments for a camporee (summary)
   * @param camporeeId - The local_camporee_id
   * @param status - Optional status filter. Defaults to excluding pending_approval
   */
  async getCamporeePayments(camporeeId: number, status?: string) {
    // Validate camporee exists
    await this.findOne(camporeeId);

    // Safety cap: a camporee payment list grows proportionally to member count.
    // 5 000 covers 1 000 members × 5 payment installments each.
    return this.prisma.camporee_payments.findMany({
      where: {
        camporee_member: {
          camporee_id: camporeeId,
        },
        ...(status ? { status } : { status: { not: 'pending_approval' } }),
      },
      include: {
        camporee_member: {
          select: {
            camporee_member_id: true,
            camporee_id: true,
            user_id: true,
            club_name: true,
            users: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
        registrar: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: { paid_at: 'desc' },
      take: 5000,
    });
  }

  /**
   * Update an existing payment
   * @param paymentId - The camporee_payment_id (UUID)
   * @param dto - Update payment DTO
   */
  async updatePayment(paymentId: string, dto: UpdatePaymentDto) {
    const payment = await this.prisma.camporee_payments.findUnique({
      where: { camporee_payment_id: paymentId },
    });

    if (!payment) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_PAYMENT_NOT_FOUND, {
        id: paymentId,
      });
    }

    const updateData: Record<string, any> = {};

    if (dto.amount !== undefined) updateData.amount = dto.amount;
    if (dto.payment_type !== undefined)
      updateData.payment_type = dto.payment_type;
    if (dto.reference !== undefined) updateData.reference = dto.reference;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.paid_at !== undefined) updateData.paid_at = new Date(dto.paid_at);

    return this.prisma.camporee_payments.update({
      where: { camporee_payment_id: paymentId },
      data: updateData,
      include: {
        camporee_member: {
          select: {
            camporee_member_id: true,
            user_id: true,
            users: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
        registrar: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
    });
  }

  // ========================================
  // PAYMENT VOUCHERS (R2-backed receipt files)
  // ========================================

  private static readonly VOUCHER_MAX_BYTES = 10 * 1024 * 1024; // 10MB
  private static readonly VOUCHER_ALLOWED_MIMES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  /**
   * Resolve the safe file extension from a multer file's mimetype.
   * Never trust originalname for extension derivation (security).
   */
  private extensionFromVoucherMime(mime: string): string {
    switch (mime) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      case 'application/pdf':
        return 'pdf';
      default:
        // Should be unreachable — caller validates the mimetype first.
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_PAYMENT_VOUCHER_MIME_INVALID,
        );
    }
  }

  /**
   * Load a payment scoped to the given camporee. Throws 404 if payment is
   * missing, 400 if the payment does not belong to the camporee. Resolves the
   * payment for both local and union camporees by walking through the member
   * (camporee_members.camporee_id or .union_camporee_id).
   */
  private async loadPaymentInCamporee(
    camporeeId: number,
    paymentId: string,
    opts: { kind: 'local' | 'union' },
  ) {
    const payment = await this.prisma.camporee_payments.findUnique({
      where: { camporee_payment_id: paymentId },
      include: { camporee_member: true },
    });

    if (!payment) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_PAYMENT_NOT_FOUND, {
        id: paymentId,
      });
    }

    const member = payment.camporee_member;
    const matches =
      opts.kind === 'local'
        ? member.camporee_id === camporeeId
        : member.union_camporee_id === camporeeId;

    if (!matches) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_PAYMENT_SCOPE_MISMATCH,
        { paymentId, camporeeId },
      );
    }

    return payment;
  }

  /**
   * Attach a voucher file (image or PDF) to an existing camporee payment.
   * Replaces any previously stored voucher: the old object is best-effort
   * deleted from R2 after the DB row is updated.
   *
   * @param camporeeId The local_camporee_id this payment must belong to.
   * @param paymentId The camporee_payment_id (UUID).
   * @param file Multer-parsed file (memory storage; buffer required).
   */
  async uploadPaymentVoucher(
    camporeeId: number,
    paymentId: string,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_PAYMENT_VOUCHER_REQUIRED,
      );
    }

    if (file.size > CamporeesService.VOUCHER_MAX_BYTES) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_PAYMENT_VOUCHER_TOO_LARGE,
      );
    }

    if (!CamporeesService.VOUCHER_ALLOWED_MIMES.includes(file.mimetype)) {
      throw new AppBadRequestException(
        ErrorCode.CAMPOREE_PAYMENT_VOUCHER_MIME_INVALID,
      );
    }

    const payment = await this.loadPaymentInCamporee(camporeeId, paymentId, {
      kind: 'local',
    });

    // Build key: camporee-payments/{camporeeId}/{paymentId}/{ts}-{uuid}.{ext}
    // The bucket keyPrefix ('camporee-payments') is prepended by R2 service.
    const ext = this.extensionFromVoucherMime(file.mimetype);
    const objectKey = `${camporeeId}/${paymentId}/${Date.now()}-${randomUUID()}.${ext}`;

    const uploadResult = await this.fileStorage.upload(
      StorageBucketAlias.CAMPOREE_PAYMENT_VOUCHERS,
      objectKey,
      file.buffer,
      { contentType: file.mimetype, overwrite: false },
    );

    const previousVoucherUrl = payment.voucher_url;

    const updated = await this.prisma.camporee_payments.update({
      where: { camporee_payment_id: paymentId },
      data: {
        voucher_url: uploadResult.url,
        voucher_uploaded_at: new Date(),
      },
      include: {
        camporee_member: {
          select: {
            camporee_member_id: true,
            user_id: true,
            users: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
        registrar: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
    });

    // Best-effort delete of the prior voucher (no failure propagation).
    if (previousVoucherUrl && previousVoucherUrl !== uploadResult.url) {
      try {
        const prevKey = this.fileStorage.extractKeyFromPublicUrl(
          StorageBucketAlias.CAMPOREE_PAYMENT_VOUCHERS,
          previousVoucherUrl,
        );
        if (prevKey) {
          await this.fileStorage.deleteMany(
            StorageBucketAlias.CAMPOREE_PAYMENT_VOUCHERS,
            [prevKey],
          );
        }
      } catch (err) {
        this.logger.warn(
          `Failed to delete previous voucher for payment=${paymentId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return updated;
  }

  /**
   * Detach a voucher file from an existing camporee payment.
   * The R2 object is best-effort deleted; failures are logged but do not
   * block the DB update.
   */
  async removePaymentVoucher(camporeeId: number, paymentId: string) {
    const payment = await this.loadPaymentInCamporee(camporeeId, paymentId, {
      kind: 'local',
    });

    if (payment.voucher_url) {
      try {
        const key = this.fileStorage.extractKeyFromPublicUrl(
          StorageBucketAlias.CAMPOREE_PAYMENT_VOUCHERS,
          payment.voucher_url,
        );
        if (key) {
          await this.fileStorage.deleteMany(
            StorageBucketAlias.CAMPOREE_PAYMENT_VOUCHERS,
            [key],
          );
        }
      } catch (err) {
        this.logger.warn(
          `Failed to delete voucher for payment=${paymentId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return this.prisma.camporee_payments.update({
      where: { camporee_payment_id: paymentId },
      data: {
        voucher_url: null,
        voucher_uploaded_at: null,
      },
      include: {
        camporee_member: {
          select: {
            camporee_member_id: true,
            user_id: true,
            users: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
        registrar: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
    });
  }

  // ========================================
  // UNION CAMPOREE ENROLLMENT
  // ========================================

  /**
   * Enroll a club section in a union camporee
   * @param unionCamporeeId - The union_camporee_id
   * @param dto - Enroll club DTO
   * @param registeredBy - User ID performing the enrollment
   */
  async enrollClubToUnion(
    unionCamporeeId: number,
    dto: EnrollClubDto,
    registeredBy: string,
  ) {
    let isLate = false;
    let camporeeUnionId: number | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Validate union camporee exists and is active
      const camporee = await tx.union_camporees.findUnique({
        where: { union_camporee_id: unionCamporeeId },
      });

      if (!camporee) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND,
          { id: unionCamporeeId },
        );
      }

      if (!camporee.active) {
        throw new AppBadRequestException(ErrorCode.CAMPOREE_NOT_ACTIVE);
      }
      const clubRegistrationDisposition =
        this.resolveClubRegistrationDisposition(camporee);
      if (
        clubRegistrationDisposition === 'manually_frozen' ||
        clubRegistrationDisposition === 'not_open_yet'
      ) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_CLUB_REGISTRATION_CLOSED,
        );
      }

      isLate = clubRegistrationDisposition === 'late_approval_required';
      camporeeUnionId = camporee.union_id;

      // 2. Validate club section exists and get club info
      const clubSection = await tx.club_sections.findUnique({
        where: { club_section_id: dto.club_section_id },
        include: {
          clubs: { select: { local_field_id: true, club_id: true } },
        },
      });

      if (!clubSection) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_CLUB_SECTION_NOT_FOUND,
          { id: dto.club_section_id },
        );
      }

      // 3. Ensure we can determine the club's local field
      if (clubSection.clubs?.local_field_id == null) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_CLUB_LOCAL_FIELD_UNKNOWN,
        );
      }

      // 4. Validate that the club's local field participates in this union camporee
      const fieldParticipation = await tx.union_camporee_local_fields.findFirst(
        {
          where: {
            union_camporee_lf_id: unionCamporeeId,
            local_field_id: clubSection.clubs.local_field_id,
            active: true,
          },
        },
      );

      if (!fieldParticipation) {
        throw new AppForbiddenException(
          ErrorCode.CAMPOREE_CLUB_LOCAL_FIELD_NOT_PARTICIPATING,
        );
      }

      // 5. Check for duplicate enrollment
      const existingEnrollment = await tx.camporee_clubs.findFirst({
        where: {
          union_camporee_id: unionCamporeeId,
          club_section_id: dto.club_section_id,
          active: true,
        },
      });

      if (existingEnrollment) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_CLUB_ALREADY_ENROLLED,
        );
      }

      // 6. Create enrollment
      return tx.camporee_clubs.create({
        data: {
          union_camporee_id: unionCamporeeId,
          camporee_type: 'union',
          club_section_id: dto.club_section_id,
          club_id: clubSection.clubs?.club_id,
          local_field_id: clubSection.clubs?.local_field_id,
          status: isLate ? 'pending_approval' : 'registered',
          registered_by: registeredBy,
          active: true,
        },
        include: {
          club_sections: {
            include: {
              club_types: { select: { club_type_id: true, name: true } },
              clubs: { select: { club_id: true, name: true } },
            },
          },
          registrar: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
        },
      });
    });

    if (isLate && camporeeUnionId) {
      setImmediate(() => {
        void this.notificationsService.sendToGlobalRole(
          ['director-union', 'assistant-union'],
          'Inscripción tardía por revisar',
          'Un club se inscribió fuera de plazo al camporee de unión y necesita revisión',
          { camporeeId: String(unionCamporeeId), type: 'club_enrollment' },
          undefined,
          'camporees:late_enrollment',
          camporeeUnionId ?? undefined,
        );
      });
    }

    return result;
  }

  /**
   * Register a member in a union camporee with insurance validation
   * @param unionCamporeeId - The union_camporee_id
   * @param dto - Register member DTO
   */
  async registerMemberToUnion(unionCamporeeId: number, dto: RegisterMemberDto) {
    let isLate = false;
    let camporeeUnionId: number | null = null;
    let camporeeName: string | null = null;

    const member = await this.prisma.$transaction(async (tx) => {
      // 1. Validate union camporee exists
      const camporee = await tx.union_camporees.findUnique({
        where: { union_camporee_id: unionCamporeeId },
      });

      if (!camporee) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND,
          { id: unionCamporeeId },
        );
      }

      // Validate camporee is active
      if (!camporee.active) {
        throw new AppBadRequestException(ErrorCode.CAMPOREE_NOT_ACTIVE);
      }

      isLate = this.camporeeLifecyclePolicy.isAfterDeadline(
        camporee.member_registration_deadline,
      );
      camporeeUnionId = camporee.union_id;
      camporeeName = camporee.name;

      // 2. Validate user exists
      const user = await tx.users.findUnique({
        where: { user_id: dto.user_id },
      });

      if (!user) {
        throw new AppBadRequestException(ErrorCode.CAMPOREE_USER_NOT_FOUND);
      }

      // 3. Check for duplicate registration
      const existingRegistration = await tx.camporee_members.findFirst({
        where: {
          union_camporee_id: unionCamporeeId,
          user_id: dto.user_id,
          active: true,
        },
      });

      if (existingRegistration) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_MEMBER_ALREADY_REGISTERED,
        );
      }

      // 4. If insurance_id is provided, validate insurance
      if (dto.insurance_id) {
        const insurance = await tx.member_insurances.findUnique({
          where: { insurance_id: dto.insurance_id },
        });

        // Validate insurance exists
        if (!insurance) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_INSURANCE_NOT_FOUND,
          );
        }

        // Validate insurance belongs to the user
        if (insurance.user_id !== dto.user_id) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_INSURANCE_NOT_OWNER,
          );
        }

        // Validate insurance type is eligible for camporees
        if (
          !CamporeesService.isEligibleCamporeeInsuranceType(
            insurance.insurance_type,
          )
        ) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_INSURANCE_TYPE_INVALID,
          );
        }

        // Validate insurance is not expired before camporee ends
        if (insurance.end_date < camporee.end_date) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_INSURANCE_EXPIRED,
          );
        }

        // Validate insurance is active
        if (!insurance.active) {
          throw new AppBadRequestException(
            ErrorCode.CAMPOREE_INSURANCE_NOT_ACTIVE,
          );
        }
      }

      // 5. Create registration in camporee_members
      const member = await tx.camporee_members.create({
        data: {
          union_camporee_id: unionCamporeeId,
          camporee_type: 'union',
          user_id: dto.user_id,
          club_name: dto.club_name,
          insurance_verified: !!dto.insurance_id,
          insurance_id: dto.insurance_id,
          status: isLate ? 'pending_approval' : 'registered',
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

    if (isLate && camporeeUnionId) {
      setImmediate(() => {
        void this.notificationsService.sendToGlobalRole(
          ['director-union', 'assistant-union'],
          'Inscripción tardía por revisar',
          'Un miembro se inscribió fuera de plazo al camporee de unión y necesita revisión',
          { camporeeId: String(unionCamporeeId), type: 'member_enrollment' },
          undefined,
          'camporees:late_enrollment',
          camporeeUnionId ?? undefined,
        );
      });
    }

    try {
      await this.achievementsService.emitEvent({
        userId: dto.user_id,
        eventType: 'camporee.participated',
        payload: {
          camporee_id: unionCamporeeId,
          camporee_name: camporeeName,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit achievement event: ${(error as Error).message}`,
      );
    }

    return this.applySignedPrivateUrls(member);
  }

  /**
   * Register a payment for a union camporee member
   * @param unionCamporeeId - The union_camporee_id
   * @param memberId - The camporee_member_id
   * @param dto - Create payment DTO
   * @param registeredBy - User ID performing the registration
   */
  async createUnionPayment(
    unionCamporeeId: number,
    memberId: number,
    dto: CreatePaymentDto,
    registeredBy: string,
  ) {
    let isLate = false;
    let camporeeUnionId: number | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Validate union camporee exists
      const camporee = await tx.union_camporees.findUnique({
        where: { union_camporee_id: unionCamporeeId },
      });

      if (!camporee) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND,
          { id: unionCamporeeId },
        );
      }

      isLate = this.camporeeLifecyclePolicy.isAfterDeadline(
        camporee.payment_deadline,
      );
      camporeeUnionId = camporee.union_id;

      // 2. Validate member is registered in this union camporee
      const member = await tx.camporee_members.findFirst({
        where: {
          camporee_member_id: memberId,
          union_camporee_id: unionCamporeeId,
          active: true,
        },
      });

      if (!member) {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_MEMBER_NOT_FOUND, {
          id: memberId,
        });
      }

      // 3. Create payment
      return tx.camporee_payments.create({
        data: {
          camporee_member_id: memberId,
          amount: dto.amount,
          payment_type: dto.payment_type,
          reference: dto.reference,
          notes: dto.notes,
          registered_by: registeredBy,
          paid_at: new Date(dto.paid_at),
          status: isLate ? 'pending_approval' : 'registered',
        },
        include: {
          camporee_member: {
            select: {
              camporee_member_id: true,
              user_id: true,
              users: {
                select: {
                  name: true,
                  paternal_last_name: true,
                  maternal_last_name: true,
                },
              },
            },
          },
          registrar: {
            select: {
              user_id: true,
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
        },
      });
    });

    if (isLate && camporeeUnionId) {
      setImmediate(() => {
        void this.notificationsService.sendToGlobalRole(
          ['director-union', 'assistant-union'],
          'Pago tardío por revisar',
          'Se registró un pago fuera de plazo y necesita revisión',
          { camporeeId: String(unionCamporeeId), type: 'payment' },
          undefined,
          'camporees:late_payment',
          camporeeUnionId ?? undefined,
        );
      });
    }

    return result;
  }

  /**
   * Get all enrolled clubs for a union camporee
   * @param unionCamporeeId - The union_camporee_id
   * @param status - Optional status filter. Defaults to excluding pending_approval
   */
  async getUnionEnrolledClubs(unionCamporeeId: number, status?: string) {
    // Validate union camporee exists
    await this.findOneUnion(unionCamporeeId);

    // Safety cap: a union camporee aggregates multiple local fields.
    // 2 000 covers a large union with many clubs across sections.
    return this.prisma.camporee_clubs.findMany({
      where: {
        union_camporee_id: unionCamporeeId,
        active: true,
        ...(status ? { status } : { status: { not: 'pending_approval' } }),
      },
      include: {
        club_sections: {
          include: {
            club_types: { select: { club_type_id: true, name: true } },
            clubs: { select: { club_id: true, name: true } },
          },
        },
        registrar: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
      take: 2000,
    });
  }

  /**
   * Get all members registered for a union camporee (paginated)
   * @param unionCamporeeId - The union_camporee_id
   * @param status - Optional status filter. Defaults to excluding pending_approval
   * @param pagination - Pagination parameters (page, limit). Default: page=1, limit=100. Max limit: 200
   */
  async getUnionMembers(
    unionCamporeeId: number,
    status?: string,
    pagination?: UnionMembersListQueryDto,
  ): Promise<PaginatedResult<any>> {
    // Validate union camporee exists
    await this.findOneUnion(unionCamporeeId);

    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 100;
    const skip = (page - 1) * limit;

    const where = {
      union_camporee_id: unionCamporeeId,
      active: true,
      ...(status ? { status } : { status: { not: 'pending_approval' } }),
    };

    const include = {
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
    };

    const [members, total] = await this.prisma.$transaction([
      this.prisma.camporee_members.findMany({
        where,
        include,
        orderBy: { created_at: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.camporee_members.count({ where }),
    ]);

    const data = await Promise.all(
      members.map((member) =>
        PROFILE_URL_LIMITER(() => this.applySignedPrivateUrls(member)),
      ),
    );

    const paginationDto = Object.assign(new UnionMembersListQueryDto(), {
      page,
      limit,
    });
    return createPaginatedResult(data, total, paginationDto);
  }

  /**
   * Get all payments for a union camporee (summary)
   * @param unionCamporeeId - The union_camporee_id
   * @param status - Optional status filter. Defaults to excluding pending_approval
   */
  async getUnionCamporeePayments(unionCamporeeId: number, status?: string) {
    // Validate union camporee exists
    await this.findOneUnion(unionCamporeeId);

    // Safety cap: union camporee aggregates many local fields; 5 000 payments
    // covers 1 000 members × 5 installments.
    return this.prisma.camporee_payments.findMany({
      where: {
        camporee_member: {
          union_camporee_id: unionCamporeeId,
        },
        ...(status ? { status } : { status: { not: 'pending_approval' } }),
      },
      include: {
        camporee_member: {
          select: {
            camporee_member_id: true,
            user_id: true,
            club_name: true,
            users: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
        registrar: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: { paid_at: 'desc' },
      take: 5000,
    });
  }

  /**
   * Get all payments for a specific union camporee member
   * @param unionCamporeeId - The union_camporee_id
   * @param memberId - The camporee_member_id
   * @param status - Optional status filter. Defaults to excluding pending_approval
   */
  async getUnionMemberPayments(
    unionCamporeeId: number,
    memberId: number,
    status?: string,
  ) {
    // Validate union camporee exists
    await this.findOneUnion(unionCamporeeId);

    // Validate member belongs to this union camporee
    const member = await this.prisma.camporee_members.findFirst({
      where: {
        camporee_member_id: memberId,
        union_camporee_id: unionCamporeeId,
      },
    });

    if (!member) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_MEMBER_NOT_FOUND, {
        id: memberId,
      });
    }

    // Safety cap: a single member is unlikely to have more than 200 payments.
    return this.prisma.camporee_payments.findMany({
      where: {
        camporee_member_id: memberId,
        ...(status ? { status } : { status: { not: 'pending_approval' } }),
      },
      include: {
        registrar: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: { paid_at: 'desc' },
      take: 200,
    });
  }

  /**
   * Cancel a club enrollment in a union camporee (soft delete)
   * @param unionCamporeeId - The union_camporee_id
   * @param camporeeClubId - The camporee_club_id to cancel
   */
  async cancelUnionClubEnrollment(
    unionCamporeeId: number,
    camporeeClubId: number,
  ) {
    // Validate union camporee exists
    await this.findOneUnion(unionCamporeeId);

    const enrollment = await this.prisma.camporee_clubs.findFirst({
      where: {
        camporee_club_id: camporeeClubId,
        union_camporee_id: unionCamporeeId,
        active: true,
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_CLUB_ENROLLMENT_NOT_FOUND,
        { id: camporeeClubId },
      );
    }

    return this.prisma.camporee_clubs.update({
      where: { camporee_club_id: camporeeClubId },
      data: {
        active: false,
        status: 'cancelled',
        modified_at: new Date(),
      },
    });
  }

  /**
   * Remove a member from a union camporee (soft delete)
   * @param unionCamporeeId - The union_camporee_id
   * @param userId - The user_id to remove
   */
  async removeUnionMember(unionCamporeeId: number, userId: string) {
    // Validate union camporee exists
    await this.findOneUnion(unionCamporeeId);

    // Find the registration
    const registration = await this.prisma.camporee_members.findFirst({
      where: {
        union_camporee_id: unionCamporeeId,
        user_id: userId,
        active: true,
      },
    });

    if (!registration) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_MEMBER_NOT_FOUND, {
        id: userId,
      });
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
    _registeredBy: string,
  ) {
    return this.registerMember(camporeeId, dto);
  }

  /**
   * Legacy method - delegates to getMembers with pagination
   * @deprecated Use getMembers instead
   */
  async getParticipants(
    camporeeId: number,
    pagination?: CamporeeMembersListQueryDto,
  ): Promise<PaginatedResult<any>> {
    return this.getMembers(camporeeId, undefined, pagination);
  }

  private async applySignedPrivateUrls<T extends Record<string, any>>(
    member: T,
  ): Promise<T> {
    if (!member?.users) return member;

    const userImage =
      typeof member.users.user_image === 'string'
        ? await this.resolvePrivateProfileUrl(member.users.user_image)
        : member.users.user_image;

    return {
      ...member,
      users: {
        ...member.users,
        user_image: userImage,
      },
    };
  }

  private async resolvePrivateProfileUrl(
    value: string | null | undefined,
  ): Promise<string | null> {
    if (!value) return null;

    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        value,
        {
          expiresInSeconds: CamporeesService.PRIVATE_ASSET_URL_TTL_SECONDS,
        },
      );
    } catch (error) {
      this.logger.warn(
        'Failed to generate signed URL for camporee member profile. Returning original value.',
        error,
      );
      return value;
    }
  }

  private applyCamporeeScope(
    where: Record<string, unknown>,
    authorization?: AuthorizationSnapshot,
  ) {
    const scope = this.resolveCamporeeAccessScope(authorization);
    if (!scope) {
      return;
    }

    if (scope.type === 'local_field') {
      where.local_field_id = scope.id;
      return;
    }

    where.local_fields = {
      union_id: scope.id,
    };
  }

  private resolveActiveClubGrant(
    authorization: AuthorizationSnapshot,
  ): ClubAuthorizationGrant {
    const activeAssignmentId = authorization?.active_assignment?.assignment_id;
    const activeGrant = authorization?.grants?.club_assignments?.find(
      (grant) => grant.assignment_id === activeAssignmentId,
    );

    if (
      !activeAssignmentId ||
      !activeGrant ||
      activeGrant.status !== 'active'
    ) {
      throw new AppForbiddenException(
        ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
      );
    }

    return activeGrant;
  }

  private async loadActiveSectionRegistrationContext(
    db: CamporeeRegistrationDb,
    camporeeId: number,
    activeGrant: ClubAuthorizationGrant,
  ) {
    const localFieldId = activeGrant.scope.local_field?.id;
    if (typeof localFieldId !== 'number') {
      throw new AppForbiddenException(
        ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
      );
    }

    const camporee = await db.local_camporees.findFirst({
      where: {
        local_camporee_id: camporeeId,
        local_field_id: localFieldId,
      },
      select: {
        local_camporee_id: true,
        local_field_id: true,
        active: true,
        includes_adventurers: true,
        includes_pathfinders: true,
        includes_master_guides: true,
        start_date: true,
        end_date: true,
        club_registration_opens_at: true,
        club_registration_deadline: true,
        club_registration_closed_at: true,
        member_registration_deadline: true,
        payment_deadline: true,
        timezone: true,
        timezone_verified_at: true,
      },
    });

    if (!camporee) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_NOT_FOUND, {
        id: camporeeId,
      });
    }
    if (!camporee.active) {
      throw new AppBadRequestException(ErrorCode.CAMPOREE_NOT_ACTIVE);
    }

    const section = await db.club_sections.findUnique({
      where: { club_section_id: activeGrant.section.club_section_id },
      select: {
        club_section_id: true,
        name: true,
        active: true,
        club_type_id: true,
        main_club_id: true,
        clubs: {
          select: {
            club_id: true,
            name: true,
            active: true,
            local_field_id: true,
          },
        },
        club_types: {
          select: {
            club_type_id: true,
            name: true,
            active: true,
          },
        },
      },
    });

    if (
      !section ||
      !section.active ||
      !section.clubs ||
      !section.clubs.active ||
      section.main_club_id !== activeGrant.club.club_id ||
      section.clubs.club_id !== activeGrant.club.club_id ||
      section.club_type_id !== activeGrant.section.club_type_id ||
      section.club_types.club_type_id !== activeGrant.section.club_type_id ||
      section.clubs.local_field_id !== localFieldId ||
      section.clubs.local_field_id !== camporee.local_field_id
    ) {
      throw new AppForbiddenException(
        ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
      );
    }

    return {
      camporee,
      section: {
        ...section,
        clubs: section.clubs,
      },
    };
  }

  private async lockLocalCamporeeRegistrationGate(
    db: CamporeeRegistrationDb,
    camporeeId: number,
    activeGrant: ClubAuthorizationGrant,
  ): Promise<void> {
    const localFieldId = activeGrant.scope.local_field?.id;
    if (typeof localFieldId !== 'number') {
      throw new AppForbiddenException(
        ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
      );
    }

    const lockedRows = await db.$queryRaw<
      Array<{ local_camporee_id: number }>
    >(Prisma.sql`
      SELECT "local_camporee_id"
      FROM "local_camporees"
      WHERE "local_camporee_id" = ${camporeeId}
        AND "local_field_id" = ${localFieldId}
      FOR UPDATE
    `);

    if (lockedRows.length === 0) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_NOT_FOUND, {
        id: camporeeId,
      });
    }
  }

  private findActiveSectionEnrollment(
    db: CamporeeRegistrationDb,
    camporeeId: number,
    clubSectionId: number,
  ) {
    return db.camporee_clubs.findFirst({
      where: {
        camporee_id: camporeeId,
        club_section_id: clubSectionId,
        active: true,
      },
      select: {
        camporee_club_id: true,
        status: true,
        created_at: true,
        registrar: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
    });
  }

  private isLocalActiveSectionUniqueConstraintError(error: unknown): boolean {
    const errorRecord = this.asRecord(error);
    if (errorRecord?.code !== 'P2002') {
      return false;
    }

    const meta = this.asRecord(errorRecord.meta);
    const adapterError = this.asRecord(meta?.driverAdapterError);
    const adapterCause = this.asRecord(adapterError?.cause);
    const directCause = this.asRecord(errorRecord.cause);
    const explicitConstraint = [
      meta?.target,
      meta?.constraint,
      adapterCause?.constraint,
      directCause?.constraint,
    ].find((value) => value !== undefined && value !== null);

    // Prisma 7's pg adapter normally reports { fields: [...] }. Some Prisma
    // paths omit target metadata; those may continue only to the exact-winner
    // lookup in the catch block, which must succeed before a replay is returned.
    if (explicitConstraint === undefined) {
      return true;
    }

    return this.matchesLocalActiveSectionConstraint(explicitConstraint);
  }

  private matchesLocalActiveSectionConstraint(value: unknown): boolean {
    const constraint = this.asRecord(value);
    const index =
      typeof value === 'string'
        ? value
        : typeof constraint?.index === 'string'
          ? constraint.index
          : null;
    if (index !== null) {
      return index === 'uq_camporee_clubs_active_local_section';
    }

    const fields = Array.isArray(value)
      ? value
      : Array.isArray(constraint?.fields)
        ? constraint.fields
        : null;
    if (!fields || !fields.every((field) => typeof field === 'string')) {
      return false;
    }

    const normalizedFields = fields.map((field) => field.replaceAll('"', ''));
    return (
      normalizedFields.length === 2 &&
      normalizedFields.includes('camporee_id') &&
      normalizedFields.includes('club_section_id')
    );
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  }

  private notifyLateActiveSectionRegistration(
    camporeeId: number,
    localFieldId: number,
  ): void {
    setImmediate(() => {
      void this.notificationsService.sendToGlobalRole(
        ['director-lf', 'assistant-lf'],
        'Inscripción tardía por revisar',
        'Un club se inscribió fuera de plazo al camporee y necesita revisión',
        { camporeeId: String(camporeeId), type: 'club_enrollment' },
        localFieldId,
        'camporees:late_enrollment',
      );
    });
  }

  private mapActiveSectionRegistration(input: {
    camporeeId: number;
    activeGrant: ClubAuthorizationGrant;
    section: {
      club_section_id: number;
      name: string | null;
      active: boolean;
      club_type_id: number;
      main_club_id: number | null;
      clubs: {
        club_id: number;
        name: string;
        active: boolean;
        local_field_id: number;
      };
      club_types: {
        club_type_id: number;
        name: string;
        active: boolean;
      };
    };
    enrollment: {
      camporee_club_id: number;
      status: string;
      created_at: Date;
      registrar: {
        user_id: string;
        name: string | null;
        paternal_last_name: string | null;
        maternal_last_name: string | null;
      } | null;
    } | null;
    disposition: SectionRegistrationDisposition;
    clubTypeIncluded: boolean;
  }): CamporeeSectionRegistrationDto {
    const { activeGrant, enrollment, disposition } = input;
    const director = activeGrant.role_name.trim().toLowerCase() === 'director';
    const canEnrollByDisposition =
      disposition === 'open' || disposition === 'late_approval_required';

    let blockingReason: string | null = null;
    if (enrollment) {
      blockingReason = 'already_enrolled';
    } else if (!director) {
      blockingReason = 'director_role_required';
    } else if (!input.clubTypeIncluded) {
      blockingReason = 'club_type_not_included';
    } else if (!canEnrollByDisposition) {
      blockingReason = disposition;
    }

    const registrar = enrollment?.registrar ?? null;
    const displayName = registrar
      ? [
          registrar.name,
          registrar.paternal_last_name,
          registrar.maternal_last_name,
        ]
          .filter((part): part is string => Boolean(part?.trim()))
          .join(' ')
      : null;

    return {
      camporeeId: input.camporeeId,
      clubId: input.section.clubs.club_id,
      clubName: input.section.clubs.name,
      clubSectionId: input.section.club_section_id,
      sectionName: input.section.name?.trim() || input.section.club_types.name,
      clubTypeId: input.section.club_type_id,
      clubTypeName: input.section.club_types.name,
      status: enrollment
        ? this.mapSectionRegistrationStatus(enrollment.status)
        : 'not_enrolled',
      disposition,
      canEnroll:
        !enrollment &&
        director &&
        input.clubTypeIncluded &&
        canEnrollByDisposition,
      blockingReason,
      enrollmentId: enrollment?.camporee_club_id ?? null,
      registeredAt: enrollment?.created_at ?? null,
      registeredBy: registrar
        ? {
            userId: registrar.user_id,
            displayName: displayName || registrar.user_id,
          }
        : null,
    };
  }

  private mapSectionRegistrationStatus(
    status: string,
  ): SectionRegistrationStatus {
    const statusMap: Record<string, SectionRegistrationStatus> = {
      registered: 'registered',
      pending_approval: 'pending_approval',
      approved: 'approved',
      rejected: 'rejected',
      cancelled: 'cancelled',
    };

    const mappedStatus = statusMap[status];
    if (!mappedStatus) {
      throw new AppInternalServerErrorException(
        ErrorCode.CAMPOREE_CLUB_ENROLLMENT_STATUS_INVALID,
      );
    }

    return mappedStatus;
  }

  private isClubTypeIncludedInCamporee(
    clubTypeId: number,
    camporee: {
      includes_adventurers: boolean | null;
      includes_pathfinders: boolean | null;
      includes_master_guides: boolean | null;
    },
  ): boolean {
    if (clubTypeId === 1) return camporee.includes_adventurers === true;
    if (clubTypeId === 2) return camporee.includes_pathfinders === true;
    if (clubTypeId === 3) return camporee.includes_master_guides === true;
    return false;
  }

  private applyUnionCamporeeScope(
    where: Record<string, unknown>,
    authorization?: AuthorizationSnapshot,
  ) {
    const scope = this.resolveCamporeeAccessScope(authorization);
    if (!scope) {
      return;
    }

    if (scope.type === 'union') {
      where.union_id = scope.id;
      return;
    }

    // local_field scope: show union camporees where the local field participates
    if (scope.type === 'local_field') {
      where.union_camporee_local_fields = {
        some: {
          local_field_id: scope.id,
          active: true,
        },
      };
    }
  }

  private async assertCanManageUnion(
    unionId: number,
    authorization?: AuthorizationSnapshot,
  ) {
    const scope = this.resolveCamporeeAccessScope(authorization);
    if (!scope) {
      return;
    }

    if (scope.type === 'union' && scope.id === unionId) {
      return;
    }

    throw new AppForbiddenException(ErrorCode.CAMPOREE_UNION_ACCESS_DENIED);
  }

  private async assertCanManageLocalField(
    localFieldId: number,
    authorization?: AuthorizationSnapshot,
  ) {
    const scope = this.resolveCamporeeAccessScope(authorization);
    if (!scope) {
      return;
    }

    if (scope.type === 'local_field' && scope.id === localFieldId) {
      return;
    }

    if (scope.type === 'union') {
      const localField = await this.prisma.local_fields.findUnique({
        where: { local_field_id: localFieldId },
        select: { union_id: true },
      });

      if (localField?.union_id === scope.id) {
        return;
      }

      throw new AppForbiddenException(
        ErrorCode.CAMPOREE_LOCAL_FIELD_ACCESS_DENIED,
      );
    }

    throw new AppForbiddenException(
      ErrorCode.CAMPOREE_LOCAL_FIELD_ACCESS_DENIED,
    );
  }

  private resolveCamporeeAccessScope(
    authorization?: AuthorizationSnapshot,
  ):
    | { type: 'local_field'; id: number }
    | { type: 'union'; id: number }
    | null {
    if (!authorization) {
      return null;
    }

    const globalRoles = authorization.grants.global_roles;
    if (this.hasGlobalRole(globalRoles, ['super-admin'])) {
      return null;
    }

    const globalScope = authorization.effective.scope.global;
    const globalLocalFieldId = globalScope.local_field?.id;
    if (
      typeof globalLocalFieldId === 'number' &&
      this.hasGlobalRole(globalRoles, [
        'admin',
        'assistant-admin',
        'coordinator',
      ])
    ) {
      return { type: 'local_field', id: globalLocalFieldId };
    }

    const globalUnionId = globalScope.union?.id;
    if (
      typeof globalUnionId === 'number' &&
      this.hasGlobalRole(globalRoles, ['admin', 'assistant-admin'])
    ) {
      return { type: 'union', id: globalUnionId };
    }

    const activeAssignmentId = authorization.active_assignment.assignment_id;
    const activeGrant = authorization.grants.club_assignments.find(
      (assignment) => assignment.assignment_id === activeAssignmentId,
    );
    const activeLocalFieldId = activeGrant?.scope.local_field?.id;

    if (typeof activeLocalFieldId === 'number') {
      return { type: 'local_field', id: activeLocalFieldId };
    }

    return null;
  }

  private hasGlobalRole(
    grants: GlobalAuthorizationGrant[],
    roleNames: string[],
  ) {
    const normalized = new Set(
      roleNames.map((roleName) => roleName.toLowerCase()),
    );
    return grants.some((grant) =>
      normalized.has(grant.role_name.toLowerCase()),
    );
  }

  private lifecycleContextFromDto(
    dto: Partial<
      | CreateCamporeeDto
      | UpdateCamporeeDto
      | CreateUnionCamporeeDto
      | UpdateUnionCamporeeDto
    >,
    existing?: Record<string, unknown>,
  ): CamporeeLifecycleContext {
    for (const field of ['start_date', 'end_date'] as const) {
      const value = dto[field];
      if (typeof value === 'string') {
        this.camporeeLifecyclePolicy.assertDateOnly(value);
      }
    }

    for (const field of [
      'club_registration_opens_at',
      'club_registration_deadline',
      'member_registration_deadline',
      'payment_deadline',
    ] as const) {
      const value = dto[field];
      if (typeof value === 'string') {
        this.camporeeLifecyclePolicy.assertOffsetTimestamp(value);
      }
    }

    const startDate =
      this.calendarDate(dto.start_date ?? existing?.start_date) ?? '1970-01-01';
    const endDate =
      this.calendarDate(dto.end_date ?? existing?.end_date) ?? '9999-12-31';
    return {
      startDate,
      endDate,
      clubRegistrationOpensAt: this.timestamp(
        dto.club_registration_opens_at !== undefined
          ? dto.club_registration_opens_at
          : existing?.club_registration_opens_at,
      ),
      clubRegistrationDeadline: this.timestamp(
        dto.club_registration_deadline ?? existing?.club_registration_deadline,
      ),
      memberRegistrationDeadline: this.timestamp(
        dto.member_registration_deadline ??
          existing?.member_registration_deadline,
      ),
      paymentDeadline: this.timestamp(
        dto.payment_deadline ?? existing?.payment_deadline,
      ),
      clubRegistrationClosedAt: this.timestamp(
        existing?.club_registration_closed_at,
      ),
      timezone:
        dto.timezone ??
        (existing?.timezone as string | undefined) ??
        CamporeesService.DEFAULT_CAMPOREE_TIMEZONE,
      timezoneVerifiedAt: this.timestamp(existing?.timezone_verified_at),
    };
  }

  private resolveClubRegistrationDisposition(
    camporee: Record<string, unknown>,
  ) {
    return this.camporeeLifecyclePolicy.resolveClubRegistrationDisposition(
      this.lifecycleContextFromDto({}, camporee),
    );
  }

  private assertTimezoneInput(timezone: unknown): void {
    if (timezone !== undefined) {
      this.camporeeLifecyclePolicy.assertIanaTimezone(timezone);
    }
  }

  private calendarDate(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return undefined;
  }

  private timestamp(value: unknown): Date | null {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string') {
      return new Date(value);
    }
    return null;
  }
}
