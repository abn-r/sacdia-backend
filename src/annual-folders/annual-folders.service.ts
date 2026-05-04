import { Inject, Injectable } from '@nestjs/common';
import 'multer';
import pLimit from 'p-limit';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import type { folder_templates } from '@prisma/client';
import { annual_folder_section_status_enum } from '@prisma/client';
import {
  CreateTemplateDto,
  CreateTemplateSectionDto,
  UpdateTemplateSectionDto,
  UploadEvidenceDto,
  UpdateEvidenceDto,
  SetReviewerNoteDto,
} from './dto';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

// Cap concurrent presign calls for EVIDENCE_FILES bucket. A folder can contain
// many sections × many files each — without the cap, a single getFolder request
// could fire hundreds of simultaneous HMAC presigns, blocking the event loop.
// Cap is 20, matching the pattern used by PROFILE_URL_LIMITER in
// camporees.service.ts and EVIDENCE_URL_LIMITER in classes.service.ts.
export const EVIDENCE_FILES_URL_LIMITER = pLimit(20);

@Injectable()
export class AnnualFoldersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  // ========================================
  // TEMPLATE MANAGEMENT (Admin)
  // ========================================

  /**
   * Create a folder template for a specific club type and ecclesiastical year.
   * Ownership (union or local_field) must be provided. The combination of
   * club_type_id + ecclesiastical_year_id + owner must be unique per owner tier.
   */
  async createTemplate(dto: CreateTemplateDto) {
    // NOTE: uniqueness is now enforced per-owner-tier via partial unique indexes
    // (see migration 20260415100000_folder_templates_polymorphic_owner).
    // Duplicate violations are raised by the DB constraint.

    // Enforce exactly-one owner rule
    const hasUnionOwner = dto.owner_union_id != null;
    const hasLocalFieldOwner = dto.owner_local_field_id != null;
    if (hasUnionOwner === hasLocalFieldOwner) {
      throw new AppBadRequestException(ErrorCode.ANNUAL_FOLDER_OWNER_REQUIRED);
    }

    // Validate that club_type and ecclesiastical_year exist
    const [clubType, year] = await Promise.all([
      this.prisma.club_types.findUnique({
        where: { club_type_id: dto.club_type_id },
      }),
      this.prisma.ecclesiastical_years.findUnique({
        where: { year_id: dto.ecclesiastical_year_id },
      }),
    ]);

    if (!clubType) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_CLUB_TYPE_NOT_FOUND,
        { id: dto.club_type_id },
      );
    }

    if (!year) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_YEAR_NOT_FOUND, {
        id: dto.ecclesiastical_year_id,
      });
    }

    return this.prisma.folder_templates.create({
      data: {
        name: dto.name,
        club_type_id: dto.club_type_id,
        ecclesiastical_year_id: dto.ecclesiastical_year_id,
        active: dto.active ?? true,
        owner_union_id: dto.owner_union_id ?? null,
        owner_local_field_id: dto.owner_local_field_id ?? null,
      },
      include: {
        club_type: { select: { name: true } },
        ecclesiastical_year: {
          select: { start_date: true, end_date: true },
        },
      },
    });
  }

  /**
   * Add a section to an existing template.
   */
  async addTemplateSection(templateId: string, dto: CreateTemplateSectionDto) {
    const template = await this.prisma.folder_templates.findUnique({
      where: { folder_template_id: templateId },
    });

    if (!template) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_TEMPLATE_NOT_FOUND,
        { id: templateId },
      );
    }

    return this.prisma.folder_template_sections.create({
      data: {
        folder_template_id: templateId,
        name: dto.name,
        description: dto.description,
        order: dto.order,
        required: dto.required ?? true,
        max_points: dto.max_points,
        minimum_points: dto.minimum_points ?? 0,
      },
    });
  }

  /**
   * Update a template section.
   */
  async updateTemplateSection(
    sectionId: string,
    dto: UpdateTemplateSectionDto,
  ) {
    const section = await this.prisma.folder_template_sections.findUnique({
      where: { section_id: sectionId },
    });

    if (!section) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_TEMPLATE_SECTION_NOT_FOUND,
        { id: sectionId },
      );
    }

    return this.prisma.folder_template_sections.update({
      where: { section_id: sectionId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.required !== undefined && { required: dto.required }),
        ...(dto.max_points !== undefined && { max_points: dto.max_points }),
        ...(dto.minimum_points !== undefined && {
          minimum_points: dto.minimum_points,
        }),
      },
    });
  }

  /**
   * Remove a template section.
   */
  async removeTemplateSection(sectionId: string) {
    const section = await this.prisma.folder_template_sections.findUnique({
      where: { section_id: sectionId },
      include: {
        _count: { select: { evidences: true } },
      },
    });

    if (!section) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_TEMPLATE_SECTION_NOT_FOUND,
        { id: sectionId },
      );
    }

    if (section._count.evidences > 0) {
      throw new AppConflictException(
        ErrorCode.ANNUAL_FOLDER_SECTION_HAS_EVIDENCES,
      );
    }

    await this.prisma.folder_template_sections.delete({
      where: { section_id: sectionId },
    });

    return { message: 'Section deleted successfully' };
  }

  /**
   * Get a template by club type and ecclesiastical year, with all sections.
   * Returns the first active template found for the given pair regardless of owner tier.
   * Phase B2 will add owner-scoped resolution (resolveTemplateForClub).
   */
  async getTemplateByClubTypeAndYear(clubTypeId: number, yearId: number) {
    const template = await this.prisma.folder_templates.findFirst({
      where: {
        club_type_id: clubTypeId,
        ecclesiastical_year_id: yearId,
        active: true,
      },
      include: {
        club_type: { select: { name: true } },
        ecclesiastical_year: {
          select: { start_date: true, end_date: true },
        },
        sections: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!template) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_TEMPLATE_NO_MATCH,
        { clubTypeId, yearId },
      );
    }

    return template;
  }

  /**
   * Get a template by ID with all sections.
   */
  async getTemplate(templateId: string) {
    const template = await this.prisma.folder_templates.findUnique({
      where: { folder_template_id: templateId },
      include: {
        club_type: { select: { name: true } },
        ecclesiastical_year: {
          select: { start_date: true, end_date: true },
        },
        sections: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!template) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_TEMPLATE_NOT_FOUND,
        { id: templateId },
      );
    }

    return template;
  }

  // ========================================
  // ANNUAL FOLDER OPERATIONS (Club level)
  // ========================================

  /**
   * Create an annual folder for a club enrollment, based on the matching template.
   * Automatically selects the template matching the enrollment's club type and year.
   */
  async createFolderForEnrollment(enrollmentId: string) {
    // Check if folder already exists for this enrollment
    const existingFolder = await this.prisma.annual_folders.findUnique({
      where: { club_enrollment_id: enrollmentId },
    });

    if (existingFolder) {
      throw new AppConflictException(ErrorCode.ANNUAL_FOLDER_ALREADY_EXISTS);
    }

    // resolveTemplateForClub loads the enrollment internally and throws
    // NotFoundException if not found or no matching template exists.
    const { template } = await this.resolveTemplateForClub(
      enrollmentId,
      undefined,
    );

    return this.prisma.$transaction(async (tx) => {
      // Load template sections once, inside the transaction.
      const sections = await tx.folder_template_sections.findMany({
        where: { folder_template_id: template.folder_template_id },
      });

      const camporeeLink = await this.resolveCamporeeLinkageForEnrollment(
        enrollmentId,
        tx,
      );

      const folder = await tx.annual_folders.create({
        data: {
          club_enrollment_id: enrollmentId,
          folder_template_id: template.folder_template_id,
          status: 'open',
          ...camporeeLink,
        },
        include: {
          folder_template: {
            include: {
              sections: { orderBy: { order: 'asc' } },
              club_type: { select: { name: true } },
            },
          },
        },
      });

      // Eagerly create one evaluation row per template section (atomic with folder creation).
      if (sections.length > 0) {
        await tx.annual_folder_section_evaluations.createMany({
          data: sections.map((section) => ({
            annual_folder_id: folder.annual_folder_id,
            section_id: section.section_id,
            earned_points: 0,
            max_points: section.max_points,
            notes: null,
            status: annual_folder_section_status_enum.PENDING,
          })),
        });
      }

      return folder;
    });
  }

  /**
   * Get an annual folder by ID with its template sections, evidences, and evaluations.
   */
  async getFolder(folderId: string) {
    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
      include: {
        club_enrollment: {
          select: {
            club_enrollment_id: true,
            club_section_id: true,
            ecclesiastical_year_id: true,
            status: true,
          },
        },
        folder_template: {
          include: {
            sections: { orderBy: { order: 'asc' } },
            club_type: { select: { name: true } },
            ecclesiastical_year: {
              select: { start_date: true, end_date: true },
            },
          },
        },
        evidences: {
          include: {
            section: { select: { section_id: true, name: true } },
            uploader: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
            reviewer: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
          orderBy: { created_at: 'asc' },
        },
        evaluations: {
          select: {
            evaluation_id: true,
            section_id: true,
            status: true,
            earned_points: true,
            max_points: true,
            notes: true,
            lf_approved_at: true,
            union_approved_at: true,
            union_decision: true,
            lf_approver: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
            union_approver: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
        section_submissions: {
          include: {
            submitter: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
      },
    });

    if (!folder) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
        id: folderId,
      });
    }

    await this.presignFolderEvidences(folder.evidences);
    return this.formatFolderResponse(folder);
  }

  /**
   * Get an annual folder by enrollment ID with sections, evidences, and evaluations.
   */
  async getFolderByEnrollment(enrollmentId: string) {
    const folder = await this.prisma.annual_folders.findUnique({
      where: { club_enrollment_id: enrollmentId },
      include: {
        club_enrollment: {
          select: {
            club_enrollment_id: true,
            club_section_id: true,
            ecclesiastical_year_id: true,
            status: true,
          },
        },
        folder_template: {
          include: {
            sections: { orderBy: { order: 'asc' } },
            club_type: { select: { name: true } },
            ecclesiastical_year: {
              select: { start_date: true, end_date: true },
            },
          },
        },
        evidences: {
          include: {
            section: { select: { section_id: true, name: true } },
            uploader: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
            reviewer: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
          orderBy: { created_at: 'asc' },
        },
        evaluations: {
          select: {
            evaluation_id: true,
            section_id: true,
            status: true,
            earned_points: true,
            max_points: true,
            notes: true,
            lf_approved_at: true,
            union_approved_at: true,
            union_decision: true,
            lf_approver: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
            union_approver: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
        section_submissions: {
          include: {
            submitter: {
              select: {
                name: true,
                paternal_last_name: true,
                maternal_last_name: true,
              },
            },
          },
        },
      },
    });

    if (!folder) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_ENROLLMENT_NOT_FOUND,
        { id: enrollmentId },
      );
    }

    await this.presignFolderEvidences(folder.evidences);
    return this.formatFolderResponse(folder);
  }

  // ========================================
  // EVIDENCE OPERATIONS
  // ========================================

  /**
   * Upload evidence to a section (only if folder status is 'open').
   * Accepts a multipart file that is uploaded to R2 internally.
   */
  async uploadEvidence(
    folderId: string,
    sectionId: string,
    dto: UploadEvidenceDto,
    userId: string,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer) {
      throw new AppBadRequestException(ErrorCode.ANNUAL_FOLDER_FILE_REQUIRED);
    }

    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
    });

    if (!folder) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
        id: folderId,
      });
    }

    if (folder.status !== 'open') {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_FOLDER_STATUS_INVALID_FOR_UPLOAD,
        { status: folder.status },
      );
    }

    // Validate section belongs to the folder's template
    const section = await this.prisma.folder_template_sections.findFirst({
      where: {
        section_id: sectionId,
        folder_template_id: folder.folder_template_id,
      },
    });

    if (!section) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_SECTION_NOT_IN_TEMPLATE,
        { sectionId },
      );
    }

    const extension = this.resolveFileExtension(file);
    const objectKey = `annual-evidence-${folderId}-${sectionId}-${Date.now()}.${extension}`;
    const uploaded = await this.fileStorage.upload(
      StorageBucketAlias.EVIDENCE_FILES,
      objectKey,
      file.buffer,
      { contentType: file.mimetype },
    );

    const created = await this.prisma.annual_folder_evidences.create({
      data: {
        annual_folder_id: folderId,
        section_id: sectionId,
        file_url: uploaded.url,
        file_name: file.originalname || objectKey,
        uploaded_by: userId,
        notes: dto.notes,
      },
      include: {
        section: { select: { section_id: true, name: true } },
        uploader: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
    });

    return this.presignSingleEvidence(created);
  }

  /**
   * Asserts that `userId` is allowed to mutate evidence in the folder that
   * owns `evidenceId`. Access is granted when ANY of these is true:
   *   1. The user holds the `super_admin` global role (god-mode bypass).
   *   2. The user has at least one active `club_role_assignment` whose
   *      section belongs to the same club that owns the annual folder.
   *
   * Throws `ForbiddenException` when neither condition is met.
   * Throws `NotFoundException` when the evidence or its parent folder
   * cannot be resolved (should not happen in normal flow but kept for safety).
   *
   * NOTE: This check intentionally does NOT replicate the H-02 pattern from
   * scoring-categories (which omits the super_admin bypass). Super-admins must
   * remain unblocked.
   */
  private async assertEvidenceClubAccess(
    evidenceId: string,
    userId: string,
  ): Promise<void> {
    // Resolve the club that owns this evidence in a single query.
    // Path: evidence → annual_folder → club_enrollment → club_section (relation)
    //       → clubs (via main_club_id FK) → club_id
    const evidence = await this.prisma.annual_folder_evidences.findUnique({
      where: { evidence_id: evidenceId },
      select: {
        annual_folder: {
          select: {
            club_enrollment: {
              select: {
                club_section: {
                  select: {
                    clubs: {
                      select: { club_id: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const clubId =
      evidence?.annual_folder?.club_enrollment?.club_section?.clubs?.club_id;

    if (clubId == null) {
      // Evidence exists but its club chain could not be resolved — treat as
      // not found so an attacker cannot enumerate valid evidence IDs.
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_EVIDENCE_CLUB_NOT_RESOLVED,
        { evidenceId },
      );
    }

    // 1. Super-admin bypass — users_roles → roles (GLOBAL category, super_admin name)
    const superAdminGrant = await this.prisma.users_roles.findFirst({
      where: {
        user_id: userId,
        active: true,
        roles: {
          active: true,
          role_category: 'GLOBAL',
          role_name: 'super_admin',
        },
      },
      select: { user_role_id: true },
    });

    if (superAdminGrant) {
      return;
    }

    // 2. Club-level check — at least one active assignment in any section of
    //    the same club (club_sections → clubs via main_club_id).
    const clubAssignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: userId,
        active: true,
        status: 'active',
        club_sections: {
          clubs: {
            club_id: clubId,
          },
        },
      },
      select: { assignment_id: true },
    });

    if (!clubAssignment) {
      throw new AppForbiddenException(
        ErrorCode.ANNUAL_FOLDER_EVIDENCE_ACCESS_DENIED,
      );
    }
  }

  /**
   * Asserts that `userId` is allowed to submit or close the folder identified
   * by `folderId`. Access is granted when ANY of these is true:
   *   1. The user holds the `super_admin` global role (god-mode bypass).
   *   2. The user has at least one active `club_role_assignment` whose section
   *      belongs to the same club that owns the annual folder.
   *
   * Resolution chain: annual_folder → club_enrollment → club_section → clubs
   *
   * Throws `ForbiddenException` when neither condition is met.
   * Throws `NotFoundException` when the folder's club chain cannot be resolved.
   *
   * [H-03 fix] Called at the START of submitFolder / closeFolder, before any
   * $transaction is opened, so we never hold a connection for an unauthorized
   * request.
   */
  private async assertFolderClubAccess(
    folderId: string,
    userId: string,
  ): Promise<void> {
    // Resolve the club that owns this folder in a single query.
    // Path: annual_folder → club_enrollment → club_section → clubs.club_id
    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
      select: {
        club_enrollment: {
          select: {
            club_section: {
              select: {
                clubs: {
                  select: { club_id: true },
                },
              },
            },
          },
        },
      },
    });

    const clubId = folder?.club_enrollment?.club_section?.clubs?.club_id;

    if (clubId == null) {
      // Folder doesn't exist or its club chain is broken — surface as 404 so
      // an attacker cannot distinguish missing folder from an access denial.
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_EVIDENCE_CLUB_NOT_RESOLVED,
        { evidenceId: folderId },
      );
    }

    // 1. Super-admin bypass
    const superAdminGrant = await this.prisma.users_roles.findFirst({
      where: {
        user_id: userId,
        active: true,
        roles: {
          active: true,
          role_category: 'GLOBAL',
          role_name: 'super_admin',
        },
      },
      select: { user_role_id: true },
    });

    if (superAdminGrant) {
      return;
    }

    // 2. Club-level check — at least one active assignment in any section of
    //    the same club.
    const clubAssignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: userId,
        active: true,
        status: 'active',
        club_sections: {
          clubs: {
            club_id: clubId,
          },
        },
      },
      select: { assignment_id: true },
    });

    if (!clubAssignment) {
      throw new AppForbiddenException(
        ErrorCode.ANNUAL_FOLDER_FOLDER_ACCESS_DENIED,
      );
    }
  }

  /**
   * Asserts that the reviewer (`userId`) may annotate evidence identified by
   * `evidenceId`. Access is granted when ANY of these is true:
   *   1. The user holds the `super_admin` global role.
   *   2. The user has an active club_role_assignment in the evidence's exact
   *      club (same as the assertEvidenceClubAccess club-level check).
   *   3. The reviewer's `users.local_field_id` matches the evidence club's
   *      `clubs.local_field_id` — i.e. the reviewer is an LF-tier actor whose
   *      territory contains this club.
   *   4. The reviewer's `users.union_id` matches the evidence club's
   *      `local_fields.union_id` — i.e. a union-tier reviewer.
   *
   * Territory is modeled directly on the `users` row via `local_field_id` and
   * `union_id` columns (schema lines 1007 & 1012). No separate reviewer-scope
   * table exists — the canonical pattern used across all LF/union actors in
   * this codebase (see authorization-context.service.ts canManageClub).
   *
   * Throws `ForbiddenException` when no condition is met.
   * Throws `NotFoundException` when the evidence's club chain cannot be
   * resolved (prevents ID enumeration).
   */
  private async assertEvidenceTerritoryAccess(
    evidenceId: string,
    userId: string,
  ): Promise<void> {
    // Resolve the club + its territory in one query.
    // Path: evidence → annual_folder → club_enrollment → club_section
    //       → clubs → (club_id, local_field_id) → local_fields → union_id
    const evidence = await this.prisma.annual_folder_evidences.findUnique({
      where: { evidence_id: evidenceId },
      select: {
        annual_folder: {
          select: {
            club_enrollment: {
              select: {
                club_section: {
                  select: {
                    clubs: {
                      select: {
                        club_id: true,
                        local_field_id: true,
                        local_fields: {
                          select: { union_id: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const club = evidence?.annual_folder?.club_enrollment?.club_section?.clubs;

    if (!club?.club_id) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_EVIDENCE_CLUB_NOT_RESOLVED,
        { evidenceId },
      );
    }

    const evidenceClubId = club.club_id;
    const evidenceLocalFieldId = club.local_field_id;
    const evidenceUnionId = club.local_fields?.union_id ?? null;

    // 1. Super-admin bypass
    const superAdminGrant = await this.prisma.users_roles.findFirst({
      where: {
        user_id: userId,
        active: true,
        roles: {
          active: true,
          role_category: 'GLOBAL',
          role_name: 'super_admin',
        },
      },
      select: { user_role_id: true },
    });

    if (superAdminGrant) {
      return;
    }

    // 2. Club-level assignment check (same club)
    const clubAssignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: userId,
        active: true,
        status: 'active',
        club_sections: {
          clubs: { club_id: evidenceClubId },
        },
      },
      select: { assignment_id: true },
    });

    if (clubAssignment) {
      return;
    }

    // 3. Territory check via users.local_field_id / users.union_id.
    // Reviewer territory is the direct columns on the users row — this is the
    // canonical model for LF and union actors across the entire codebase.
    const reviewer = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { local_field_id: true, union_id: true },
    });

    if (!reviewer) {
      throw new AppForbiddenException(
        ErrorCode.ANNUAL_FOLDER_EVIDENCE_TERRITORY_DENIED,
      );
    }

    // LF-tier: reviewer.local_field_id must match the evidence club's local_field_id
    if (
      reviewer.local_field_id != null &&
      reviewer.local_field_id === evidenceLocalFieldId
    ) {
      return;
    }

    // Union-tier: reviewer.union_id must match the local_field's union_id
    if (
      reviewer.union_id != null &&
      evidenceUnionId != null &&
      reviewer.union_id === evidenceUnionId
    ) {
      return;
    }

    throw new AppForbiddenException(
      ErrorCode.ANNUAL_FOLDER_EVIDENCE_TERRITORY_DENIED,
    );
  }

  private resolveFileExtension(file: Express.Multer.File): string {
    const original = file.originalname ?? '';
    const ext = original.includes('.')
      ? original.split('.').pop()?.toLowerCase()
      : null;

    if (ext) return ext;

    if (file.mimetype === 'application/pdf') return 'pdf';
    if (file.mimetype === 'image/png') return 'png';
    if (file.mimetype === 'image/webp') return 'webp';
    if (file.mimetype === 'image/jpeg') return 'jpg';

    return 'bin';
  }

  /**
   * Update evidence metadata (only if folder status is 'open').
   */
  async updateEvidence(
    evidenceId: string,
    dto: UpdateEvidenceDto,
    userId: string,
  ) {
    // C-02: verify caller belongs to the club that owns this evidence
    await this.assertEvidenceClubAccess(evidenceId, userId);

    const evidence = await this.prisma.annual_folder_evidences.findUnique({
      where: { evidence_id: evidenceId },
      include: {
        annual_folder: { select: { status: true } },
      },
    });

    if (!evidence) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_EVIDENCE_NOT_FOUND,
        { id: evidenceId },
      );
    }

    if (evidence.annual_folder.status !== 'open') {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_FOLDER_STATUS_INVALID_FOR_MUTATION,
        { status: evidence.annual_folder.status },
      );
    }

    const updated = await this.prisma.annual_folder_evidences.update({
      where: { evidence_id: evidenceId },
      data: {
        ...(dto.file_url !== undefined && { file_url: dto.file_url }),
        ...(dto.file_name !== undefined && { file_name: dto.file_name }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: {
        section: { select: { section_id: true, name: true } },
        uploader: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
    });

    return this.presignSingleEvidence(updated);
  }

  /**
   * Delete evidence (only if folder status is 'open').
   */
  async deleteEvidence(evidenceId: string, userId: string) {
    // C-02: verify caller belongs to the club that owns this evidence
    await this.assertEvidenceClubAccess(evidenceId, userId);

    const evidence = await this.prisma.annual_folder_evidences.findUnique({
      where: { evidence_id: evidenceId },
      include: {
        annual_folder: { select: { status: true } },
      },
    });

    if (!evidence) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_EVIDENCE_NOT_FOUND,
        { id: evidenceId },
      );
    }

    if (evidence.annual_folder.status !== 'open') {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_FOLDER_STATUS_INVALID_FOR_MUTATION,
        { status: evidence.annual_folder.status },
      );
    }

    await this.prisma.annual_folder_evidences.delete({
      where: { evidence_id: evidenceId },
    });

    return { message: 'Evidence deleted successfully' };
  }

  // ========================================
  // REVIEWER NOTE ON EVIDENCE
  // ========================================

  /**
   * Set (or clear) a reviewer note on a specific evidence file.
   *
   * Only users with the `annual_folders:evaluate` permission (assistant-lf,
   * director-lf and higher) should reach this method — enforcement is done at
   * the controller layer via PermissionsGuard.
   *
   * Passing null or an empty string clears the note and resets the audit fields.
   * Any non-empty string saves the note and records who set it and when.
   */
  async setReviewerNote(
    evidenceId: string,
    dto: SetReviewerNoteDto,
    reviewerUserId: string,
  ) {
    // Territory check: evidence's club must be within the reviewer's
    // local_field or union territory (super_admin bypass applies).
    await this.assertEvidenceTerritoryAccess(evidenceId, reviewerUserId);

    const evidence = await this.prisma.annual_folder_evidences.findUnique({
      where: { evidence_id: evidenceId },
    });

    if (!evidence) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_EVIDENCE_NOT_FOUND,
        { id: evidenceId },
      );
    }

    const hasNote =
      dto.reviewer_note !== null &&
      dto.reviewer_note !== undefined &&
      dto.reviewer_note.trim().length > 0;

    const noted = await this.prisma.annual_folder_evidences.update({
      where: { evidence_id: evidenceId },
      data: {
        reviewer_note: hasNote ? dto.reviewer_note!.trim() : null,
        reviewer_noted_by: hasNote ? reviewerUserId : null,
        reviewer_noted_at: hasNote ? new Date() : null,
      },
      include: {
        section: { select: { section_id: true, name: true } },
        uploader: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
        reviewer: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
    });

    return this.presignSingleEvidence(noted);
  }

  // ========================================
  // SECTION STATUS QUERY
  // ========================================

  /**
   * Return the current status snapshot for a single section within a folder.
   *
   * Response includes:
   *  - Section template metadata (name, required, points)
   *  - Evidence count for this section
   *  - Submission record (if any)
   *  - Evaluation record (if any)
   *  - Evaluation record including stored `status`, `lf_approver`, `union_approver`, `union_decision`
   */
  async getSectionStatus(folderId: string, sectionId: string) {
    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
      select: {
        annual_folder_id: true,
        folder_template_id: true,
        status: true,
      },
    });

    if (!folder) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
        id: folderId,
      });
    }

    // Validate section belongs to this folder's template
    const section = await this.prisma.folder_template_sections.findFirst({
      where: {
        section_id: sectionId,
        folder_template_id: folder.folder_template_id,
      },
    });

    if (!section) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_SECTION_NOT_IN_TEMPLATE,
        { sectionId },
      );
    }

    // Fetch evidence count, submission, and evaluation in parallel
    const [evidenceCount, submission, evaluation] = await Promise.all([
      this.prisma.annual_folder_evidences.count({
        where: { annual_folder_id: folderId, section_id: sectionId },
      }),
      this.prisma.annual_folder_section_submissions.findUnique({
        where: {
          annual_folder_id_section_id: {
            annual_folder_id: folderId,
            section_id: sectionId,
          },
        },
        include: {
          submitter: {
            select: {
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
        },
      }),
      this.prisma.annual_folder_section_evaluations.findUnique({
        where: {
          annual_folder_id_section_id: {
            annual_folder_id: folderId,
            section_id: sectionId,
          },
        },
        select: {
          evaluation_id: true,
          status: true,
          earned_points: true,
          max_points: true,
          notes: true,
          lf_approved_at: true,
          union_approved_at: true,
          union_decision: true,
          lf_approver: {
            select: {
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
          union_approver: {
            select: {
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
        },
      }),
    ]);

    return {
      folder_id: folderId,
      folder_status: folder.status,
      section: {
        section_id: section.section_id,
        name: section.name,
        description: section.description,
        order: section.order,
        required: section.required,
        max_points: section.max_points,
        minimum_points: section.minimum_points,
      },
      evidence_count: evidenceCount,
      submission: submission
        ? {
            section_submission_id: submission.section_submission_id,
            submitted_at: submission.submitted_at,
            submitted_by: this.formatUserName(submission.submitter),
          }
        : null,
      evaluation: evaluation
        ? {
            evaluation_id: evaluation.evaluation_id,
            status: evaluation.status,
            earned_points: evaluation.earned_points,
            max_points: evaluation.max_points,
            notes: evaluation.notes,
            lf_approver: this.formatUserName(evaluation.lf_approver),
            lf_approved_at: evaluation.lf_approved_at ?? null,
            union_approver:
              this.formatUserName(evaluation.union_approver) ?? null,
            union_approved_at: evaluation.union_approved_at ?? null,
            union_decision: evaluation.union_decision ?? null,
          }
        : null,
    };
  }

  // ========================================
  // STATUS TRANSITIONS
  // ========================================

  /**
   * Submit a single section of an annual folder (club user operation).
   *
   * Validates that:
   *  - The folder exists and is in 'open' status.
   *  - The section belongs to the folder's template.
   *  - The section has at least one evidence uploaded.
   *
   * Creates or updates (upsert) a row in annual_folder_section_submissions.
   */
  async submitSection(folderId: string, sectionId: string, userId: string) {
    // [M-01] Assert caller belongs to the club that owns this folder before
    // performing any DB mutations. Prevents cross-club section submission by
    // users whose evidence_folders:update permission was granted in a different club.
    await this.assertFolderClubAccess(folderId, userId);

    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
    });

    if (!folder) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
        id: folderId,
      });
    }

    if (folder.status !== 'open') {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_FOLDER_STATUS_INVALID_FOR_UPLOAD,
        { status: folder.status },
      );
    }

    // Validate that the section belongs to this folder's template
    const section = await this.prisma.folder_template_sections.findFirst({
      where: {
        section_id: sectionId,
        folder_template_id: folder.folder_template_id,
      },
    });

    if (!section) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_SECTION_NOT_IN_TEMPLATE,
        { sectionId },
      );
    }

    // Validate that at least one evidence exists for this section in this folder
    const evidenceCount = await this.prisma.annual_folder_evidences.count({
      where: {
        annual_folder_id: folderId,
        section_id: sectionId,
      },
    });

    if (evidenceCount === 0) {
      throw new AppBadRequestException(
        ErrorCode.ANNUAL_FOLDER_SECTION_NO_EVIDENCE,
        { sectionName: section.name },
      );
    }

    const now = new Date();

    // Atomically upsert the submission record and transition the evaluation
    // row from PENDING → SUBMITTED. The updateMany is idempotent: if the
    // status is already SUBMITTED or has advanced further (e.g. PREAPPROVED_LF,
    // VALIDATED, REJECTED from a re-submission after reopen), the WHERE clause
    // matches 0 rows and no change is made.
    const submission = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.annual_folder_section_submissions.upsert({
        where: {
          annual_folder_id_section_id: {
            annual_folder_id: folderId,
            section_id: sectionId,
          },
        },
        create: {
          annual_folder_id: folderId,
          section_id: sectionId,
          submitted_by: userId,
          submitted_at: now,
        },
        update: {
          submitted_by: userId,
          submitted_at: now,
          modified_at: now,
        },
      });

      await tx.annual_folder_section_evaluations.updateMany({
        where: {
          annual_folder_id: folderId,
          section_id: sectionId,
          status: annual_folder_section_status_enum.PENDING,
        },
        data: {
          status: annual_folder_section_status_enum.SUBMITTED,
        },
      });

      return sub;
    });

    return {
      section_submission_id: submission.section_submission_id,
      section_id: submission.section_id,
      annual_folder_id: submission.annual_folder_id,
      submitted_at: submission.submitted_at,
      submitted_by: userId,
    };
  }

  /**
   * Submit a folder (change status from 'open' to 'submitted').
   *
   * This is a FOLDER-LEVEL operation intended for coordinators and field admins
   * only (permission: annual_folders:submit). Regular club users submit per
   * section via POST /annual-folders/:folderId/sections/:sectionId/submit.
   *
   * [H-03] Club ownership is verified before the transaction opens: the caller
   * must have at least one active club_role_assignment in the same club that
   * owns the folder (super_admin bypass applies).
   *
   * TODO: consider enforcing that ALL required sections have at least one
   * entry in annual_folder_section_submissions before allowing the transition.
   */
  async submitFolder(folderId: string, userId: string) {
    // H-03: verify caller belongs to the club that owns this folder
    await this.assertFolderClubAccess(folderId, userId);
    return this.prisma.$transaction(async (tx) => {
      // Existence check first so callers get a clean NotFoundException when
      // the folder simply does not exist (as opposed to a state conflict).
      const folder = await tx.annual_folders.findUnique({
        where: { annual_folder_id: folderId },
        select: { annual_folder_id: true },
      });

      if (!folder) {
        throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
          id: folderId,
        });
      }

      // Atomic transition: only succeeds when status is still 'open'.
      // If a concurrent request already changed the status the count will be
      // 0 and we surface a ConflictException instead of silently double-submitting.
      const result = await tx.annual_folders.updateMany({
        where: { annual_folder_id: folderId, status: 'open' },
        data: {
          status: 'submitted',
          submitted_at: new Date(),
        },
      });

      if (result.count === 0) {
        throw new AppConflictException(ErrorCode.ANNUAL_FOLDER_STATUS_CONFLICT);
      }

      return tx.annual_folders.findUnique({
        where: { annual_folder_id: folderId },
      });
    });
  }

  /**
   * Close a folder (change status to 'closed'). Field-level action.
   * Accepts folders in 'submitted' OR 'evaluated' status.
   *
   * [H-03] Club ownership is verified before the transaction opens: the caller
   * must have at least one active club_role_assignment in the same club that
   * owns the folder (super_admin bypass applies).
   */
  async closeFolder(folderId: string, userId: string) {
    // H-03: verify caller belongs to the club that owns this folder
    await this.assertFolderClubAccess(folderId, userId);
    return this.prisma.$transaction(async (tx) => {
      // Existence check first so callers get a clean NotFoundException when
      // the folder simply does not exist (as opposed to a state conflict).
      const folder = await tx.annual_folders.findUnique({
        where: { annual_folder_id: folderId },
        select: { annual_folder_id: true },
      });

      if (!folder) {
        throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
          id: folderId,
        });
      }

      // Atomic transition: only succeeds when status is still 'submitted' or
      // 'evaluated'. A concurrent close attempt that already flipped the status
      // will yield count === 0, surfacing a ConflictException.
      const result = await tx.annual_folders.updateMany({
        where: {
          annual_folder_id: folderId,
          status: { in: ['submitted', 'evaluated'] },
        },
        data: {
          status: 'closed',
          closed_at: new Date(),
        },
      });

      if (result.count === 0) {
        throw new AppConflictException(ErrorCode.ANNUAL_FOLDER_STATUS_CONFLICT);
      }

      return tx.annual_folders.findUnique({
        where: { annual_folder_id: folderId },
      });
    });
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  /**
   * Presign all evidence file_url fields in-place using the module-level
   * EVIDENCE_FILES_URL_LIMITER (cap = 20). Mutates the evidences array so
   * that callers (getFolder, getFolderByEnrollment) can pass the same object
   * to formatFolderResponse without any further transformation.
   *
   * Evidence files are stored in the private EVIDENCE_FILES R2 bucket; the
   * stored value is the object key (not a public URL). Failing to sign a
   * single file is non-fatal: the original key is kept so the client at
   * least knows a file exists.
   */
  private async presignFolderEvidences(
    evidences: { file_url: string }[],
  ): Promise<void> {
    if (evidences.length === 0) return;
    await Promise.all(
      evidences.map((evidence) =>
        EVIDENCE_FILES_URL_LIMITER(async () => {
          try {
            evidence.file_url = await this.fileStorage.getSignedDownloadUrl(
              StorageBucketAlias.EVIDENCE_FILES,
              evidence.file_url,
            );
          } catch {
            // Non-fatal: keep original key so the client knows a file exists.
          }
        }),
      ),
    );
  }

  /**
   * Presign the file_url of a single evidence record in-place.
   *
   * Mirrors presignFolderEvidences for single-evidence return paths
   * (uploadEvidence, updateEvidence, setReviewerNote). Uses the same
   * EVIDENCE_FILES_URL_LIMITER pool so all presign calls share one cap.
   * Failure is non-fatal: the original key is kept on error.
   */
  private async presignSingleEvidence<T extends { file_url: string }>(
    evidence: T,
  ): Promise<T> {
    await EVIDENCE_FILES_URL_LIMITER(async () => {
      try {
        evidence.file_url = await this.fileStorage.getSignedDownloadUrl(
          StorageBucketAlias.EVIDENCE_FILES,
          evidence.file_url,
        );
      } catch {
        // Non-fatal: keep original key so the client knows a file exists.
      }
    });
    return evidence;
  }

  /**
   * Resolve the active folder template for a club enrollment using the
   * owner fallback chain: union-owned template first, local_field-owned second.
   *
   * Resolution order (R-C5-2):
   *  1. Try union-owned template (owner_union_id = enrollment.club.local_field.union_id)
   *  2. Fallback: local_field-owned template (owner_local_field_id = enrollment.club.local_field_id)
   *  3. Neither found → NotFoundException
   *
   * @param enrollmentId - UUID of the club enrollment
   * @param overrideYearId - Optional override for ecclesiastical_year_id.
   *   When undefined, the year is taken from the enrollment row itself.
   */
  private async resolveTemplateForClub(
    enrollmentId: string,
    overrideYearId: number | undefined,
  ): Promise<{
    template: folder_templates;
    resolvedVia: 'union' | 'local_field';
  }> {
    // Load enrollment with the full club → local_field → union chain
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      include: {
        club_section: {
          select: {
            club_type_id: true,
            main_club_id: true,
            clubs: {
              select: {
                club_id: true,
                local_field_id: true,
                local_fields: {
                  select: {
                    local_field_id: true,
                    union_id: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_ENROLLMENT_NOT_FOUND,
        { id: enrollmentId },
      );
    }

    const club = enrollment.club_section.clubs;
    if (!club) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_CLUB_NO_PARENT, {
        enrollmentId,
      });
    }

    const localField = club.local_fields;
    if (!localField) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_CLUB_NO_LOCAL_FIELD,
        { clubId: club.club_id },
      );
    }

    const clubTypeId = enrollment.club_section.club_type_id;
    const yearId = overrideYearId ?? enrollment.ecclesiastical_year_id;

    // 1. Try union-owned template first
    const unionTemplate = await this.prisma.folder_templates.findFirst({
      where: {
        club_type_id: clubTypeId,
        ecclesiastical_year_id: yearId,
        owner_union_id: localField.union_id,
        active: true,
      },
    });

    if (unionTemplate) {
      return { template: unionTemplate, resolvedVia: 'union' };
    }

    // 2. Fallback to local_field-owned template
    const lfTemplate = await this.prisma.folder_templates.findFirst({
      where: {
        club_type_id: clubTypeId,
        ecclesiastical_year_id: yearId,
        owner_local_field_id: localField.local_field_id,
        active: true,
      },
    });

    if (lfTemplate) {
      return { template: lfTemplate, resolvedVia: 'local_field' };
    }

    throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_TEMPLATE_NO_MATCH, {
      clubTypeId,
      yearId,
    });
  }

  /**
   * T-1.2 — Map a club_type_id to the corresponding includes_* column name
   * on both `local_camporees` and `union_camporees`.
   *
   * Verified mapping against prisma/seeds/folder-templates.seed.ts:
   *   1 = Aventureros (adventurers)
   *   2 = Conquistadores (pathfinders)
   *   3 = Guías Mayores (master_guides)
   *
   * T-1.1 spike result: dynamic computed-property keys in Prisma where clauses
   * compile cleanly with TypeScript strict mode — using that approach here.
   */
  private clubTypeToCamporeeIncludesColumn(
    clubTypeId: number,
  ):
    | 'includes_adventurers'
    | 'includes_pathfinders'
    | 'includes_master_guides' {
    switch (clubTypeId) {
      case 1:
        return 'includes_adventurers';
      case 2:
        return 'includes_pathfinders';
      case 3:
        return 'includes_master_guides';
      default:
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_CAMPOREE_CLUB_TYPE_INVALID,
          { clubTypeId },
        );
    }
  }

  /**
   * T-2.1 — Resolve camporee linkage for a club enrollment.
   *
   * Implements asymmetric lookup (CAMP-1):
   *  - Union tier: club must be enrolled in a union_camporee via a non-rejected
   *    camporee_clubs row. Enrollment-based — no existence-only check.
   *  - Local tier: no camporee_clubs check. A local_camporee that exists for the
   *    club's local_field + year + active + includes_<type> applies automatically.
   *  - Union-first precedence: always try union first; local is fallback.
   *  - Both null is a valid state (investiture-only folder).
   *
   * Must be called INSIDE an existing $transaction — uses the tx client throughout.
   */
  private async resolveCamporeeLinkageForEnrollment(
    enrollmentId: string,
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
  ): Promise<{
    local_camporee_id: number | null;
    union_camporee_id: number | null;
    requires_union_confirmation: boolean;
  }> {
    // Re-hydrate enrollment inside tx to get the full club → local_field chain.
    // Mirrors the pattern from resolveTemplateForClub.
    const enrollment = await tx.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      include: {
        club_section: {
          select: {
            club_section_id: true,
            club_type_id: true,
            clubs: {
              select: {
                club_id: true,
                local_fields: {
                  select: {
                    local_field_id: true,
                    union_id: true,
                  },
                },
              },
            },
          },
        },
        ecclesiastical_year: {
          select: { year_id: true },
        },
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_ENROLLMENT_NOT_FOUND,
        { id: enrollmentId },
      );
    }

    const clubSection = enrollment.club_section;
    const club = clubSection?.clubs;
    if (!club) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_CLUB_NO_PARENT, {
        enrollmentId,
      });
    }

    const localField = club.local_fields;
    if (!localField) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_CLUB_NO_LOCAL_FIELD,
        { clubId: club.club_id },
      );
    }

    const clubTypeId = clubSection.club_type_id;
    const yearId = enrollment.ecclesiastical_year.year_id;
    const includesColumn = this.clubTypeToCamporeeIncludesColumn(clubTypeId);

    // Step 1 — Union tier (enrollment-based via camporee_clubs).
    // The relation field name in schema.prisma is `union_camporees` (plural).
    const unionEnrollment = await tx.camporee_clubs.findFirst({
      where: {
        club_section_id: clubSection.club_section_id,
        active: true,
        status: { not: 'rejected' },
        union_camporee_id: { not: null },
        union_camporees: {
          active: true,
          ecclesiastical_year: yearId,
          [includesColumn]: true,
        },
      },
      orderBy: { union_camporees: { created_at: 'desc' } },
    });

    if (unionEnrollment?.union_camporee_id != null) {
      return {
        union_camporee_id: unionEnrollment.union_camporee_id,
        local_camporee_id: null,
        requires_union_confirmation: true,
      };
    }

    // Step 2 — Local tier (existence-based, no camporee_clubs check).
    const localCamporee = await tx.local_camporees.findFirst({
      where: {
        local_field_id: localField.local_field_id,
        ecclesiastical_year: yearId,
        active: true,
        [includesColumn]: true,
      },
      orderBy: { created_at: 'desc' },
    });

    if (localCamporee) {
      return {
        local_camporee_id: localCamporee.local_camporee_id,
        union_camporee_id: null,
        requires_union_confirmation: false,
      };
    }

    // Step 3 — Neither: investiture-only folder (valid state, not an error).
    return {
      local_camporee_id: null,
      union_camporee_id: null,
      requires_union_confirmation: false,
    };
  }

  private formatFolderResponse(folder: any) {
    // Group evidences by section
    const evidencesBySection = new Map<string, any[]>();
    for (const evidence of folder.evidences) {
      const sectionId = evidence.section_id;
      if (!evidencesBySection.has(sectionId)) {
        evidencesBySection.set(sectionId, []);
      }
      evidencesBySection.get(sectionId)!.push({
        evidence_id: evidence.evidence_id,
        file_url: evidence.file_url,
        file_name: evidence.file_name,
        notes: evidence.notes,
        reviewer_note: evidence.reviewer_note ?? null,
        reviewer_noted_by: this.formatUserName(evidence.reviewer) ?? null,
        reviewer_noted_at: evidence.reviewer_noted_at ?? null,
        uploaded_by: this.formatUserName(evidence.uploader),
        created_at: evidence.created_at,
      });
    }

    // Index evaluations by section_id for O(1) lookup
    const evaluationBySection = new Map<string, any>();
    for (const evaluation of folder.evaluations ?? []) {
      evaluationBySection.set(evaluation.section_id, {
        evaluation_id: evaluation.evaluation_id,
        status: evaluation.status,
        earned_points: evaluation.earned_points,
        max_points: evaluation.max_points,
        notes: evaluation.notes,
        lf_approver: this.formatUserName(evaluation.lf_approver),
        lf_approved_at: evaluation.lf_approved_at ?? null,
        union_approver: this.formatUserName(evaluation.union_approver) ?? null,
        union_approved_at: evaluation.union_approved_at ?? null,
        union_decision: evaluation.union_decision ?? null,
      });
    }

    // Index section submissions by section_id for O(1) lookup
    const submissionBySection = new Map<string, any>();
    for (const sub of folder.section_submissions ?? []) {
      submissionBySection.set(sub.section_id, {
        section_submission_id: sub.section_submission_id,
        submitted_at: sub.submitted_at,
        submitted_by: this.formatUserName(sub.submitter),
      });
    }

    // Build sections with their evidences, evaluation, and submission status
    const sections = folder.folder_template.sections.map((section: any) => {
      const submission = submissionBySection.get(section.section_id) ?? null;
      return {
        section_id: section.section_id,
        name: section.name,
        description: section.description,
        order: section.order,
        required: section.required,
        max_points: section.max_points,
        minimum_points: section.minimum_points,
        evidences: evidencesBySection.get(section.section_id) ?? [],
        evidence_count: (evidencesBySection.get(section.section_id) ?? [])
          .length,
        evaluation: evaluationBySection.get(section.section_id) ?? null,
        submission,
      };
    });

    return {
      annual_folder_id: folder.annual_folder_id,
      status: folder.status,
      submitted_at: folder.submitted_at,
      closed_at: folder.closed_at,
      evaluated_at: folder.evaluated_at,
      created_at: folder.created_at,
      total_earned_points: folder.total_earned_points,
      total_max_points: folder.total_max_points,
      progress_percentage: folder.progress_percentage,
      local_camporee_id: folder.local_camporee_id ?? null,
      union_camporee_id: folder.union_camporee_id ?? null,
      requires_union_confirmation: folder.requires_union_confirmation ?? false,
      club_enrollment: folder.club_enrollment,
      template: {
        folder_template_id: folder.folder_template.folder_template_id,
        name: folder.folder_template.name,
        club_type: folder.folder_template.club_type?.name,
        ecclesiastical_year: folder.folder_template.ecclesiastical_year,
      },
      sections,
      total_sections: sections.length,
      total_evidences: folder.evidences.length,
    };
  }

  private formatUserName(user: any) {
    if (!user) return null;
    const parts = [user.name, user.paternal_last_name, user.maternal_last_name]
      .map((part: string | null | undefined) => part?.trim())
      .filter((part): part is string => Boolean(part));
    return parts.join(' ').trim() || null;
  }
}
