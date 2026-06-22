import { Inject, Injectable, Optional } from '@nestjs/common';
import 'multer';
import pLimit from 'p-limit';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import type { folder_templates, Prisma } from '@prisma/client';
import { annual_folder_section_status_enum } from '@prisma/client';
import {
  CreateTemplateDto,
  CreateTemplateSectionDto,
  UpdateTemplateDto,
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
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';
import {
  buildEvidenceDisplayNameForFile,
  resolveEvidenceFileExtension,
} from '../common/utils/evidence-file-names';

// Cap concurrent presign calls for EVIDENCE_FILES bucket. A folder can contain
// many sections × many files each — without the cap, a single getFolder request
// could fire hundreds of simultaneous HMAC presigns, blocking the event loop.
// Cap is 20, matching the pattern used by PROFILE_URL_LIMITER in
// camporees.service.ts and EVIDENCE_URL_LIMITER in classes.service.ts.
export const EVIDENCE_FILES_URL_LIMITER = pLimit(20);

const FOLDER_QUEUE_STATUSES = [
  annual_folder_section_status_enum.SUBMITTED,
  annual_folder_section_status_enum.PREAPPROVED_LF,
];

const TEMPLATE_DETAIL_INCLUDE = {
  club_type: { select: { club_type_id: true, name: true } },
  ecclesiastical_year: {
    select: {
      year_id: true,
      start_date: true,
      end_date: true,
      active: true,
    },
  },
  owner_union: { select: { union_id: true, name: true } },
  owner_local_field: {
    select: { local_field_id: true, name: true, union_id: true },
  },
  sections: {
    orderBy: { order: 'asc' as const },
  },
};

type EvaluationQueueStatus =
  | 'needs_review'
  | 'submitted'
  | 'preapproved'
  | 'evaluated'
  | 'all';

type FolderAccessContext = {
  clubId: number;
  localFieldId: number | null;
  unionId: number | null;
};

@Injectable()
export class AnnualFoldersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    @Optional()
    private readonly hierarchy?: InstitutionalHierarchyService,
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
        minimum_points: dto.minimum_points ?? 0,
        closing_date: dto.closing_date ? new Date(dto.closing_date) : null,
        owner_union_id: dto.owner_union_id ?? null,
        owner_local_field_id: dto.owner_local_field_id ?? null,
      },
      include: TEMPLATE_DETAIL_INCLUDE,
    });
  }

  /**
   * List templates for admin screens. Filters are optional; the legacy lookup
   * by club type + year still lives in getTemplateByClubTypeAndYear.
   */
  async listTemplates(filters: {
    club_type_id?: number;
    ecclesiastical_year_id?: number;
    active?: boolean;
  }) {
    return this.prisma.folder_templates.findMany({
      where: {
        ...(filters.club_type_id !== undefined && {
          club_type_id: filters.club_type_id,
        }),
        ...(filters.ecclesiastical_year_id !== undefined && {
          ecclesiastical_year_id: filters.ecclesiastical_year_id,
        }),
        ...(filters.active !== undefined && { active: filters.active }),
      },
      include: TEMPLATE_DETAIL_INCLUDE,
      orderBy: [
        { ecclesiastical_year_id: 'desc' },
        { club_type_id: 'asc' },
        { name: 'asc' },
      ],
    });
  }

  /**
   * Update template metadata without touching section definitions.
   */
  async updateTemplate(templateId: string, dto: UpdateTemplateDto) {
    const template = await this.prisma.folder_templates.findUnique({
      where: { folder_template_id: templateId },
    });

    if (!template) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_TEMPLATE_NOT_FOUND,
        { id: templateId },
      );
    }

    const nextOwnerUnionId =
      dto.owner_union_id !== undefined
        ? dto.owner_union_id
        : template.owner_union_id;
    const nextOwnerLocalFieldId =
      dto.owner_local_field_id !== undefined
        ? dto.owner_local_field_id
        : template.owner_local_field_id;

    if ((nextOwnerUnionId != null) === (nextOwnerLocalFieldId != null)) {
      throw new AppBadRequestException(ErrorCode.ANNUAL_FOLDER_OWNER_REQUIRED);
    }

    if (dto.club_type_id !== undefined) {
      const clubType = await this.prisma.club_types.findUnique({
        where: { club_type_id: dto.club_type_id },
        select: { club_type_id: true },
      });
      if (!clubType) {
        throw new AppNotFoundException(
          ErrorCode.ANNUAL_FOLDER_CLUB_TYPE_NOT_FOUND,
          { id: dto.club_type_id },
        );
      }
    }

    if (dto.ecclesiastical_year_id !== undefined) {
      const year = await this.prisma.ecclesiastical_years.findUnique({
        where: { year_id: dto.ecclesiastical_year_id },
        select: { year_id: true },
      });
      if (!year) {
        throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_YEAR_NOT_FOUND, {
          id: dto.ecclesiastical_year_id,
        });
      }
    }

    return this.prisma.folder_templates.update({
      where: { folder_template_id: templateId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.club_type_id !== undefined && {
          club_type_id: dto.club_type_id,
        }),
        ...(dto.ecclesiastical_year_id !== undefined && {
          ecclesiastical_year_id: dto.ecclesiastical_year_id,
        }),
        ...(dto.active !== undefined && { active: dto.active }),
        ...(dto.minimum_points !== undefined && {
          minimum_points: dto.minimum_points,
        }),
        ...(dto.closing_date !== undefined && {
          closing_date: dto.closing_date ? new Date(dto.closing_date) : null,
        }),
        ...(dto.owner_union_id !== undefined && {
          owner_union_id: dto.owner_union_id,
        }),
        ...(dto.owner_local_field_id !== undefined && {
          owner_local_field_id: dto.owner_local_field_id,
        }),
      },
      include: TEMPLATE_DETAIL_INCLUDE,
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
      include: TEMPLATE_DETAIL_INCLUDE,
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
      include: TEMPLATE_DETAIL_INCLUDE,
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
   * Create an annual evidence folder for a club enrollment, based on the matching template.
   * Automatically selects the template matching the enrollment's club type and year.
   */
  async createFolderForEnrollment(enrollmentId: string, userId?: string) {
    // HTTP callers must hold evidence_folders:update in the enrollment's real
    // club. Internal system calls (e.g. enrollment auto-create) pass no userId
    // and are authorized by their outer workflow.
    if (userId) {
      await this.assertEnrollmentPermissionAccess(
        enrollmentId,
        userId,
        'evidence_folders:update',
      );
    }

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
   * Lists annual evidence folders using human-readable context so evaluators
   * do not need to know internal UUIDs. The UUID remains an API identifier only.
   */
  async getEvaluationQueue(
    userId: string,
    options: {
      search?: string;
      status?: EvaluationQueueStatus;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 25), 100);
    const skip = (page - 1) * limit;
    const search = options.search?.trim();
    const status = options.status ?? 'needs_review';

    const where = this.composeEvaluationQueueWhere([
      await this.buildEvaluationQueueAccessWhere(userId),
      this.buildEvaluationQueueStatusWhere(status),
      search ? this.buildEvaluationQueueSearchWhere(search) : {},
    ]);

    const [folders, total] = await Promise.all([
      this.prisma.annual_folders.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ modified_at: 'desc' }, { created_at: 'desc' }],
        include: {
          _count: { select: { evidences: true } },
          club_enrollment: {
            select: this.clubEnrollmentHumanSelect(),
          },
          folder_template: {
            select: {
              folder_template_id: true,
              name: true,
              club_type: { select: { name: true } },
              ecclesiastical_year: {
                select: { start_date: true, end_date: true },
              },
              sections: {
                select: { section_id: true },
              },
            },
          },
          evaluations: {
            select: {
              status: true,
              section_id: true,
              section: { select: { name: true } },
            },
          },
          section_submissions: {
            select: {
              section_id: true,
              submitted_at: true,
            },
            orderBy: { submitted_at: 'desc' },
          },
        },
      }),
      this.prisma.annual_folders.count({ where }),
    ]);

    return {
      data: folders.map((folder) => this.formatEvaluationQueueItem(folder)),
      total,
      page,
      limit,
    };
  }

  /**
   * Get an annual evidence folder by ID with its template sections, evidences, and evaluations.
   */
  async getFolder(folderId: string, userId: string) {
    const folderRef = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
      select: { annual_folder_id: true },
    });

    if (!folderRef) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
        id: folderId,
      });
    }

    await this.assertFolderReadAccess(folderId, userId);

    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
      include: {
        club_enrollment: {
          select: this.clubEnrollmentHumanSelect(),
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
   * Get an annual evidence folder by enrollment ID with sections, evidences, and evaluations.
   */
  async getFolderByEnrollment(enrollmentId: string, userId: string) {
    const folderRef = await this.prisma.annual_folders.findUnique({
      where: { club_enrollment_id: enrollmentId },
      select: { annual_folder_id: true },
    });

    if (!folderRef) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
        id: enrollmentId,
      });
    }

    await this.assertFolderReadAccess(folderRef.annual_folder_id, userId);

    const folder = await this.prisma.annual_folders.findUnique({
      where: { club_enrollment_id: enrollmentId },
      include: {
        club_enrollment: {
          select: this.clubEnrollmentHumanSelect(),
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
        id: enrollmentId,
      });
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

    await this.assertFolderPermissionAccess(
      folderId,
      userId,
      'evidence_folders:update',
    );

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

    const extension = resolveEvidenceFileExtension(file);
    const objectKey = `annual-evidence-${folderId}-${sectionId}-${Date.now()}.${extension}`;
    const existingEvidenceCount =
      await this.prisma.annual_folder_evidences.count({
        where: {
          annual_folder_id: folderId,
          section_id: sectionId,
        },
      });
    const displayName = buildEvidenceDisplayNameForFile(
      existingEvidenceCount + 1,
      file,
    );

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
        file_name: displayName,
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
   * Public resource check used by read-only sibling controllers that expose
   * annual-folder data but do not own the full folder response assembly.
   */
  async assertFolderReadAccessForUser(
    folderId: string,
    userId: string,
    permissionNames: string[] = ['evidence_folders:read'],
  ): Promise<void> {
    await this.assertFolderReadAccess(folderId, userId, permissionNames);
  }

  private async assertFolderReadAccess(
    folderId: string,
    userId: string,
    permissionNames: string[] = ['evidence_folders:read'],
  ): Promise<void> {
    const context = await this.resolveFolderAccessContext(folderId);

    if (await this.hasSystemFolderBypass(userId)) {
      return;
    }

    for (const permissionName of permissionNames) {
      if (
        await this.hasClubPermissionForClub(
          userId,
          context.clubId,
          permissionName,
        )
      ) {
        return;
      }

      const hasGlobalPermission = await this.hasGlobalPermission(
        userId,
        permissionName,
      );
      if (
        hasGlobalPermission &&
        (await this.userMatchesFolderTerritory(userId, context))
      ) {
        return;
      }
    }

    throw new AppForbiddenException(
      ErrorCode.ANNUAL_FOLDER_FOLDER_ACCESS_DENIED,
    );
  }

  private async assertFolderPermissionAccess(
    folderId: string,
    userId: string,
    permissionName: string,
  ): Promise<void> {
    const context = await this.resolveFolderAccessContext(folderId);

    if (await this.hasSystemFolderBypass(userId)) {
      return;
    }

    if (
      await this.hasClubPermissionForClub(
        userId,
        context.clubId,
        permissionName,
      )
    ) {
      return;
    }

    throw new AppForbiddenException(
      ErrorCode.ANNUAL_FOLDER_FOLDER_ACCESS_DENIED,
    );
  }

  private async assertEnrollmentPermissionAccess(
    enrollmentId: string,
    userId: string,
    permissionName: string,
  ): Promise<void> {
    const context = await this.resolveEnrollmentAccessContext(enrollmentId);

    if (await this.hasSystemFolderBypass(userId)) {
      return;
    }

    if (
      await this.hasClubPermissionForClub(
        userId,
        context.clubId,
        permissionName,
      )
    ) {
      return;
    }

    throw new AppForbiddenException(
      ErrorCode.ANNUAL_FOLDER_FOLDER_ACCESS_DENIED,
    );
  }

  private async assertEvidencePermissionAccess(
    evidenceId: string,
    userId: string,
    permissionName: string,
  ): Promise<void> {
    const context = await this.resolveEvidenceAccessContext(evidenceId);

    if (await this.hasSystemFolderBypass(userId)) {
      return;
    }

    if (
      await this.hasClubPermissionForClub(
        userId,
        context.clubId,
        permissionName,
      )
    ) {
      return;
    }

    throw new AppForbiddenException(
      ErrorCode.ANNUAL_FOLDER_EVIDENCE_ACCESS_DENIED,
    );
  }

  /**
   * Reviewer note/evaluation reads use territorial supervision: the caller must
   * be a system bypass or belong to the same local field / union as the folder.
   * Controller-level permissions still decide which global roles may reach it.
   */
  private async assertEvidenceTerritoryAccess(
    evidenceId: string,
    userId: string,
  ): Promise<void> {
    const context = await this.resolveEvidenceAccessContext(evidenceId);

    if (await this.hasSystemFolderBypass(userId)) {
      return;
    }

    if (
      await this.hasClubPermissionForClub(
        userId,
        context.clubId,
        'evidence_folders:read',
      )
    ) {
      return;
    }

    if (await this.userMatchesFolderTerritory(userId, context)) {
      return;
    }

    throw new AppForbiddenException(
      ErrorCode.ANNUAL_FOLDER_EVIDENCE_TERRITORY_DENIED,
    );
  }

  private async resolveFolderAccessContext(
    folderId: string,
  ): Promise<FolderAccessContext> {
    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
      select: {
        club_enrollment: {
          select: {
            club_section: {
              select: {
                clubs: {
                  select: {
                    club_id: true,
                    local_field_id: true,
                    local_fields: { select: { union_id: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const club = folder?.club_enrollment?.club_section?.clubs;
    if (!folder) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
        id: folderId,
      });
    }

    if (!club?.club_id) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_EVIDENCE_CLUB_NOT_RESOLVED,
        { evidenceId: folderId },
      );
    }

    return {
      clubId: club.club_id,
      localFieldId: club.local_field_id ?? null,
      unionId: club.local_fields?.union_id ?? null,
    };
  }

  private async resolveEnrollmentAccessContext(
    enrollmentId: string,
  ): Promise<FolderAccessContext> {
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      select: {
        club_section: {
          select: {
            clubs: {
              select: {
                club_id: true,
                local_field_id: true,
                local_fields: { select: { union_id: true } },
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

    const club = enrollment.club_section?.clubs;
    if (!club?.club_id) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_CLUB_NO_PARENT, {
        enrollmentId,
      });
    }

    return {
      clubId: club.club_id,
      localFieldId: club.local_field_id ?? null,
      unionId: club.local_fields?.union_id ?? null,
    };
  }

  private async resolveEvidenceAccessContext(
    evidenceId: string,
  ): Promise<FolderAccessContext> {
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
                        local_fields: { select: { union_id: true } },
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

    return {
      clubId: club.club_id,
      localFieldId: club.local_field_id ?? null,
      unionId: club.local_fields?.union_id ?? null,
    };
  }

  private async hasSystemFolderBypass(userId: string): Promise<boolean> {
    const superAdminGrant = await this.prisma.users_roles.findFirst({
      where: {
        user_id: userId,
        active: true,
        roles: {
          active: true,
          role_category: 'GLOBAL',
          role_name: 'super-admin',
        },
      },
      select: { user_role_id: true },
    });

    return Boolean(superAdminGrant);
  }

  private async hasClubPermissionForClub(
    userId: string,
    clubId: number,
    permissionName: string,
  ): Promise<boolean> {
    const clubGrant = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: userId,
        active: true,
        status: 'active',
        club_sections: {
          clubs: { club_id: clubId },
        },
        roles: {
          active: true,
          role_permissions: {
            some: {
              active: true,
              permissions: {
                active: true,
                permission_name: permissionName,
              },
            },
          },
        },
      },
      select: { assignment_id: true },
    });

    return Boolean(clubGrant);
  }

  private async hasGlobalPermission(
    userId: string,
    permissionName: string,
  ): Promise<boolean> {
    const globalGrant = await this.prisma.users_roles.findFirst({
      where: {
        user_id: userId,
        active: true,
        roles: {
          active: true,
          role_category: 'GLOBAL',
          role_permissions: {
            some: {
              active: true,
              permissions: {
                active: true,
                permission_name: permissionName,
              },
            },
          },
        },
      },
      select: { user_role_id: true },
    });

    return Boolean(globalGrant);
  }

  private async userMatchesFolderTerritory(
    userId: string,
    context: FolderAccessContext,
  ): Promise<boolean> {
    const reviewer = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { local_field_id: true, union_id: true },
    });

    if (!reviewer) return false;

    if (
      reviewer.local_field_id != null &&
      reviewer.local_field_id === context.localFieldId
    ) {
      return true;
    }

    return (
      reviewer.union_id != null &&
      context.unionId != null &&
      reviewer.union_id === context.unionId
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
    await this.assertEvidencePermissionAccess(
      evidenceId,
      userId,
      'evidence_folders:update',
    );

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
    await this.assertEvidencePermissionAccess(
      evidenceId,
      userId,
      'evidence_folders:update',
    );

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
    // local_field or union territory (super-admin bypass applies).
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
  async getSectionStatus(folderId: string, sectionId: string, userId: string) {
    await this.assertFolderReadAccess(folderId, userId);

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

  private assertSubmissionWindowOpen(closingDate: Date | null | undefined) {
    if (!closingDate) return;

    const now = new Date();
    if (now <= closingDate) return;

    throw new AppBadRequestException(
      ErrorCode.ANNUAL_FOLDER_SUBMISSION_CLOSED,
      { closingDate: closingDate.toISOString() },
    );
  }

  // ========================================
  // STATUS TRANSITIONS
  // ========================================

  /**
   * Submit a single section of an annual evidence folder (club user operation).
   *
   * Validates that:
   *  - The folder exists and is in 'open' status.
   *  - The section belongs to the folder's template.
   *  - The section has at least one evidence uploaded.
   *
   * Creates or updates (upsert) a row in annual_folder_section_submissions.
   */
  async submitSection(folderId: string, sectionId: string, userId: string) {
    await this.assertFolderPermissionAccess(
      folderId,
      userId,
      'evidence_folders:update',
    );

    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
      include: {
        folder_template: { select: { closing_date: true } },
      },
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

    this.assertSubmissionWindowOpen(folder.folder_template?.closing_date);

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
   * This is a FOLDER-LEVEL operation intended for club direction /
   * secretariat only (permission: annual_folders:submit in the folder's real
   * club). Operational club users submit per section via
   * POST /annual-folders/:folderId/sections/:sectionId/submit.
   *
   * The real folder club permission is verified before the transaction opens:
   * a submit permission granted in another club is not enough.
   *
   * Enforces that all required template sections have been submitted before
   * allowing the folder-level transition.
   */
  async submitFolder(folderId: string, userId: string) {
    await this.assertFolderPermissionAccess(
      folderId,
      userId,
      'annual_folders:submit',
    );
    return this.prisma.$transaction(async (tx) => {
      // Existence check first so callers get a clean NotFoundException when
      // the folder simply does not exist (as opposed to a state conflict).
      const folder = await tx.annual_folders.findUnique({
        where: { annual_folder_id: folderId },
        include: {
          folder_template: {
            include: {
              sections: {
                where: { required: true },
                select: { section_id: true, name: true },
                orderBy: { order: 'asc' },
              },
            },
          },
          section_submissions: {
            select: { section_id: true },
          },
        },
      });

      if (!folder) {
        throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
          id: folderId,
        });
      }

      this.assertSubmissionWindowOpen(folder.folder_template.closing_date);

      const submittedSectionIds = new Set(
        folder.section_submissions.map((submission) => submission.section_id),
      );
      const pendingRequiredSections = folder.folder_template.sections.filter(
        (section) => !submittedSectionIds.has(section.section_id),
      );

      if (pendingRequiredSections.length > 0) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_REQUIRED_SECTIONS_PENDING,
          {
            pendingSections: pendingRequiredSections
              .map((section) => section.name)
              .join(', '),
          },
        );
      }

      const requiredSectionIds = folder.folder_template.sections.map(
        (section) => section.section_id,
      );
      if (requiredSectionIds.length > 0) {
        const evidenceCounts = await tx.annual_folder_evidences.groupBy({
          by: ['section_id'],
          where: {
            annual_folder_id: folderId,
            section_id: { in: requiredSectionIds },
          },
          _count: { _all: true },
        });
        const sectionsWithEvidence = new Set(
          evidenceCounts
            .filter((row) => row._count._all > 0)
            .map((row) => row.section_id),
        );
        const firstSectionWithoutEvidence =
          folder.folder_template.sections.find(
            (section) => !sectionsWithEvidence.has(section.section_id),
          );

        if (firstSectionWithoutEvidence) {
          throw new AppBadRequestException(
            ErrorCode.ANNUAL_FOLDER_SECTION_NO_EVIDENCE,
            { sectionName: firstSectionWithoutEvidence.name },
          );
        }
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
   * The real folder club permission is verified before the transaction opens:
   * an update permission granted in another club is not enough.
   */
  async closeFolder(folderId: string, userId: string) {
    await this.assertFolderPermissionAccess(
      folderId,
      userId,
      'evidence_folders:update',
    );
    return this.prisma.$transaction(async (tx) => {
      // Existence check first so callers get a clean NotFoundException when
      // the folder simply does not exist (as opposed to a state conflict).
      const folder = await tx.annual_folders.findUnique({
        where: { annual_folder_id: folderId },
        select: {
          annual_folder_id: true,
          hierarchy_context_id: true,
          club_enrollment: {
            select: {
              club_section: {
                select: {
                  clubs: {
                    select: {
                      club_id: true,
                    },
                  },
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

      const closedAt = new Date();
      const clubId =
        folder.club_enrollment?.club_section?.clubs?.club_id ?? null;
      let hierarchyContextId: string | undefined =
        folder.hierarchy_context_id ?? undefined;

      if (!hierarchyContextId && this.hierarchy && clubId != null) {
        const snapshot = await this.hierarchy
          .snapshotForClub(clubId, closedAt, userId)
          .catch(() => null);
        hierarchyContextId = snapshot?.hierarchy_context_id ?? undefined;
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
          closed_at: closedAt,
        },
      });

      if (result.count === 0) {
        throw new AppConflictException(ErrorCode.ANNUAL_FOLDER_STATUS_CONFLICT);
      }

      if (hierarchyContextId) {
        await tx.annual_folders.updateMany({
          where: {
            annual_folder_id: folderId,
            hierarchy_context_id: null,
          },
          data: {
            hierarchy_context_id: hierarchyContextId,
          },
        });
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
      club_enrollment: this.formatClubEnrollment(folder.club_enrollment),
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

  private clubEnrollmentHumanSelect() {
    return {
      club_enrollment_id: true,
      club_section_id: true,
      ecclesiastical_year_id: true,
      status: true,
      club_section: {
        select: {
          club_section_id: true,
          name: true,
          club_types: { select: { name: true } },
          clubs: {
            select: {
              club_id: true,
              name: true,
              local_fields: {
                select: {
                  local_field_id: true,
                  name: true,
                  unions: {
                    select: {
                      union_id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      ecclesiastical_year: {
        select: {
          year_id: true,
          start_date: true,
          end_date: true,
        },
      },
    } satisfies Prisma.club_enrollmentsSelect;
  }

  private async buildEvaluationQueueAccessWhere(
    userId: string,
  ): Promise<Prisma.annual_foldersWhereInput> {
    const superAdminGrant = await this.prisma.users_roles.findFirst({
      where: {
        user_id: userId,
        active: true,
        roles: {
          active: true,
          role_category: 'GLOBAL',
          role_name: 'super-admin',
        },
      },
      select: { user_role_id: true },
    });

    if (superAdminGrant) {
      return {};
    }

    const reviewer = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { local_field_id: true, union_id: true },
    });

    const scopedWhere: Prisma.annual_foldersWhereInput[] = [
      {
        club_enrollment: {
          club_section: {
            clubs: {
              club_sections: {
                some: {
                  club_role_assignments: {
                    some: {
                      user_id: userId,
                      active: true,
                      status: 'active',
                    },
                  },
                },
              },
            },
          },
        },
      },
    ];

    if (reviewer?.local_field_id != null) {
      scopedWhere.push({
        club_enrollment: {
          club_section: {
            clubs: {
              local_field_id: reviewer.local_field_id,
            },
          },
        },
      });
    }

    if (reviewer?.union_id != null) {
      scopedWhere.push({
        club_enrollment: {
          club_section: {
            clubs: {
              local_fields: {
                union_id: reviewer.union_id,
              },
            },
          },
        },
      });
    }

    return { OR: scopedWhere };
  }

  private buildEvaluationQueueStatusWhere(
    status: EvaluationQueueStatus,
  ): Prisma.annual_foldersWhereInput {
    switch (status) {
      case 'submitted':
        return {
          evaluations: {
            some: { status: annual_folder_section_status_enum.SUBMITTED },
          },
        };
      case 'preapproved':
        return {
          evaluations: {
            some: { status: annual_folder_section_status_enum.PREAPPROVED_LF },
          },
        };
      case 'evaluated':
        return {
          evaluations: {
            some: {
              status: {
                in: [
                  annual_folder_section_status_enum.VALIDATED,
                  annual_folder_section_status_enum.REJECTED,
                ],
              },
            },
          },
        };
      case 'all':
        return {};
      case 'needs_review':
      default:
        return {
          evaluations: {
            some: { status: { in: FOLDER_QUEUE_STATUSES } },
          },
        };
    }
  }

  private buildEvaluationQueueSearchWhere(
    search: string,
  ): Prisma.annual_foldersWhereInput {
    return {
      OR: [
        {
          folder_template: { name: { contains: search, mode: 'insensitive' } },
        },
        {
          folder_template: {
            club_type: { name: { contains: search, mode: 'insensitive' } },
          },
        },
        {
          club_enrollment: {
            club_section: {
              name: { contains: search, mode: 'insensitive' },
            },
          },
        },
        {
          club_enrollment: {
            club_section: {
              club_types: {
                name: { contains: search, mode: 'insensitive' },
              },
            },
          },
        },
        {
          club_enrollment: {
            club_section: {
              clubs: { name: { contains: search, mode: 'insensitive' } },
            },
          },
        },
        {
          club_enrollment: {
            club_section: {
              clubs: {
                local_fields: {
                  name: { contains: search, mode: 'insensitive' },
                },
              },
            },
          },
        },
        {
          club_enrollment: {
            club_section: {
              clubs: {
                local_fields: {
                  unions: {
                    name: { contains: search, mode: 'insensitive' },
                  },
                },
              },
            },
          },
        },
      ],
    };
  }

  private composeEvaluationQueueWhere(
    filters: Prisma.annual_foldersWhereInput[],
  ): Prisma.annual_foldersWhereInput {
    const activeFilters = filters.filter(
      (filter) => Object.keys(filter).length > 0,
    );

    if (activeFilters.length === 0) {
      return {};
    }

    if (activeFilters.length === 1) {
      return activeFilters[0];
    }

    return { AND: activeFilters };
  }

  private formatEvaluationQueueItem(folder: any) {
    const enrollment = this.formatClubEnrollment(folder.club_enrollment);
    const clubName = enrollment?.club_section?.club?.name ?? 'Club sin nombre';
    const sectionName =
      enrollment?.club_section?.name ??
      enrollment?.club_section?.club_type?.name ??
      'Sección sin nombre';
    const yearLabel =
      enrollment?.ecclesiastical_year?.label ??
      this.formatYearLabel(folder.folder_template?.ecclesiastical_year);
    const templateName = folder.folder_template?.name ?? 'Carpeta anual';
    const submittedSections = folder.evaluations.filter(
      (evaluation: any) =>
        evaluation.status === annual_folder_section_status_enum.SUBMITTED,
    );
    const preapprovedSections = folder.evaluations.filter(
      (evaluation: any) =>
        evaluation.status === annual_folder_section_status_enum.PREAPPROVED_LF,
    );
    const validatedSections = folder.evaluations.filter(
      (evaluation: any) =>
        evaluation.status === annual_folder_section_status_enum.VALIDATED,
    );
    const rejectedSections = folder.evaluations.filter(
      (evaluation: any) =>
        evaluation.status === annual_folder_section_status_enum.REJECTED,
    );
    const queueSections = [...submittedSections, ...preapprovedSections]
      .map((evaluation: any) => evaluation.section?.name)
      .filter(Boolean);

    return {
      annual_folder_id: folder.annual_folder_id,
      display_name: `${clubName} · ${sectionName} · ${yearLabel}`,
      club_name: clubName,
      club_section_name: sectionName,
      club_type_name:
        enrollment?.club_section?.club_type?.name ??
        folder.folder_template?.club_type?.name ??
        null,
      local_field_name:
        enrollment?.club_section?.club?.local_field?.name ?? null,
      union_name:
        enrollment?.club_section?.club?.local_field?.union?.name ?? null,
      template_name: templateName,
      year_label: yearLabel,
      folder_status: folder.status,
      total_sections: folder.folder_template?.sections?.length ?? 0,
      total_evidences: folder._count?.evidences ?? 0,
      submitted_sections_count: submittedSections.length,
      preapproved_sections_count: preapprovedSections.length,
      validated_sections_count: validatedSections.length,
      rejected_sections_count: rejectedSections.length,
      pending_section_names: queueSections.slice(0, 4),
      latest_submitted_at:
        folder.section_submissions?.[0]?.submitted_at ?? null,
      created_at: folder.created_at,
    };
  }

  private formatClubEnrollment(enrollment: any) {
    if (!enrollment) return null;
    const clubSection = enrollment.club_section;
    const club = clubSection?.clubs;
    const localField = club?.local_fields;

    return {
      club_enrollment_id: enrollment.club_enrollment_id,
      club_section_id: enrollment.club_section_id,
      ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
      status: enrollment.status,
      club_section: clubSection
        ? {
            club_section_id: clubSection.club_section_id,
            name: clubSection.name,
            club_type: clubSection.club_types
              ? { name: clubSection.club_types.name }
              : null,
            club: club
              ? {
                  club_id: club.club_id,
                  name: club.name,
                  local_field: localField
                    ? {
                        local_field_id: localField.local_field_id,
                        name: localField.name,
                        union: localField.unions
                          ? {
                              union_id: localField.unions.union_id,
                              name: localField.unions.name,
                            }
                          : null,
                      }
                    : null,
                }
              : null,
          }
        : null,
      ecclesiastical_year: enrollment.ecclesiastical_year
        ? {
            year_id: enrollment.ecclesiastical_year.year_id,
            start_date: enrollment.ecclesiastical_year.start_date,
            end_date: enrollment.ecclesiastical_year.end_date,
            label: this.formatYearLabel(enrollment.ecclesiastical_year),
          }
        : null,
    };
  }

  private formatYearLabel(
    year:
      | { start_date?: Date | string | null; end_date?: Date | string | null }
      | null
      | undefined,
  ): string {
    const start = year?.start_date ? new Date(year.start_date) : null;
    const end = year?.end_date ? new Date(year.end_date) : null;
    if (
      !start ||
      !end ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      return 'Año eclesiástico';
    }
    return `${start.getUTCFullYear()}-${end.getUTCFullYear()}`;
  }
}
