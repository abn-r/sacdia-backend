import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
      throw new BadRequestException(
        'Exactly one of owner_union_id or owner_local_field_id must be provided',
      );
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
      throw new NotFoundException(
        `Club type with ID ${dto.club_type_id} not found`,
      );
    }

    if (!year) {
      throw new NotFoundException(
        `Ecclesiastical year with ID ${dto.ecclesiastical_year_id} not found`,
      );
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
      throw new NotFoundException(
        `Folder template with ID ${templateId} not found`,
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
      throw new NotFoundException(
        `Template section with ID ${sectionId} not found`,
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
      throw new NotFoundException(
        `Template section with ID ${sectionId} not found`,
      );
    }

    if (section._count.evidences > 0) {
      throw new ConflictException(
        'Cannot delete section that already has evidences uploaded',
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
      throw new NotFoundException(
        'No template found for the given club type and ecclesiastical year',
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
      throw new NotFoundException(
        `Folder template with ID ${templateId} not found`,
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
      throw new ConflictException(
        'An annual folder already exists for this enrollment',
      );
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

      // Camporee linkage is NOT resolved in this task (no active resolver exists).
      // Both fields default to null; requires_union_confirmation is false.
      // Follow-up gap: implement camporee-lookup logic once the camporee resolver is ready.
      const folder = await tx.annual_folders.create({
        data: {
          club_enrollment_id: enrollmentId,
          folder_template_id: template.folder_template_id,
          status: 'open',
          local_camporee_id: null,
          union_camporee_id: null,
          requires_union_confirmation: false,
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
      throw new NotFoundException(
        `Annual folder with ID ${folderId} not found`,
      );
    }

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
      throw new NotFoundException(
        `Annual folder for enrollment ${enrollmentId} not found`,
      );
    }

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
      throw new BadRequestException('File is required');
    }

    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
    });

    if (!folder) {
      throw new NotFoundException(
        `Annual folder with ID ${folderId} not found`,
      );
    }

    if (folder.status !== 'open') {
      throw new BadRequestException(
        `Cannot upload evidence to a folder with status '${folder.status}'. Folder must be 'open'.`,
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
      throw new NotFoundException(
        `Section ${sectionId} does not belong to this folder's template`,
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

    return this.prisma.annual_folder_evidences.create({
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
  async updateEvidence(evidenceId: string, dto: UpdateEvidenceDto) {
    const evidence = await this.prisma.annual_folder_evidences.findUnique({
      where: { evidence_id: evidenceId },
      include: {
        annual_folder: { select: { status: true } },
      },
    });

    if (!evidence) {
      throw new NotFoundException(`Evidence with ID ${evidenceId} not found`);
    }

    if (evidence.annual_folder.status !== 'open') {
      throw new BadRequestException(
        `Cannot update evidence in a folder with status '${evidence.annual_folder.status}'. Folder must be 'open'.`,
      );
    }

    return this.prisma.annual_folder_evidences.update({
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
  }

  /**
   * Delete evidence (only if folder status is 'open').
   */
  async deleteEvidence(evidenceId: string) {
    const evidence = await this.prisma.annual_folder_evidences.findUnique({
      where: { evidence_id: evidenceId },
      include: {
        annual_folder: { select: { status: true } },
      },
    });

    if (!evidence) {
      throw new NotFoundException(`Evidence with ID ${evidenceId} not found`);
    }

    if (evidence.annual_folder.status !== 'open') {
      throw new BadRequestException(
        `Cannot delete evidence in a folder with status '${evidence.annual_folder.status}'. Folder must be 'open'.`,
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
    const evidence = await this.prisma.annual_folder_evidences.findUnique({
      where: { evidence_id: evidenceId },
    });

    if (!evidence) {
      throw new NotFoundException(`Evidence with ID ${evidenceId} not found`);
    }

    const hasNote =
      dto.reviewer_note !== null &&
      dto.reviewer_note !== undefined &&
      dto.reviewer_note.trim().length > 0;

    return this.prisma.annual_folder_evidences.update({
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
      throw new NotFoundException(
        `Annual folder with ID ${folderId} not found`,
      );
    }

    // Validate section belongs to this folder's template
    const section = await this.prisma.folder_template_sections.findFirst({
      where: {
        section_id: sectionId,
        folder_template_id: folder.folder_template_id,
      },
    });

    if (!section) {
      throw new NotFoundException(
        `Section ${sectionId} does not belong to this folder's template`,
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
    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
    });

    if (!folder) {
      throw new NotFoundException(
        `Annual folder with ID ${folderId} not found`,
      );
    }

    if (folder.status !== 'open') {
      throw new BadRequestException(
        `Cannot submit a section in a folder with status '${folder.status}'. Folder must be 'open'.`,
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
      throw new NotFoundException(
        `Section ${sectionId} does not belong to this folder's template`,
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
      throw new BadRequestException(
        `Cannot submit section '${section.name}': at least one evidence file must be uploaded first`,
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
   * TODO: consider enforcing that ALL required sections have at least one
   * entry in annual_folder_section_submissions before allowing the transition.
   */
  async submitFolder(folderId: string) {
    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
    });

    if (!folder) {
      throw new NotFoundException(
        `Annual folder with ID ${folderId} not found`,
      );
    }

    if (folder.status !== 'open') {
      throw new BadRequestException(
        `Cannot submit a folder with status '${folder.status}'. Folder must be 'open'.`,
      );
    }

    return this.prisma.annual_folders.update({
      where: { annual_folder_id: folderId },
      data: {
        status: 'submitted',
        submitted_at: new Date(),
      },
    });
  }

  /**
   * Close a folder (change status to 'closed'). Field-level action.
   * Accepts folders in 'submitted' OR 'evaluated' status.
   */
  async closeFolder(folderId: string) {
    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
    });

    if (!folder) {
      throw new NotFoundException(
        `Annual folder with ID ${folderId} not found`,
      );
    }

    if (folder.status !== 'submitted' && folder.status !== 'evaluated') {
      throw new BadRequestException(
        `Cannot close a folder with status '${folder.status}'. Folder must be 'submitted' or 'evaluated'.`,
      );
    }

    return this.prisma.annual_folders.update({
      where: { annual_folder_id: folderId },
      data: {
        status: 'closed',
        closed_at: new Date(),
      },
    });
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

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
  ): Promise<{ template: folder_templates; resolvedVia: 'union' | 'local_field' }> {
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
      throw new NotFoundException(
        `Club enrollment with ID ${enrollmentId} not found`,
      );
    }

    const club = enrollment.club_section.clubs;
    if (!club) {
      throw new NotFoundException(
        `Club section for enrollment ${enrollmentId} has no parent club — cannot resolve template owner`,
      );
    }

    const localField = club.local_fields;
    if (!localField) {
      throw new NotFoundException(
        `Club ${club.club_id} has no local field — cannot resolve template owner`,
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

    throw new NotFoundException(
      `No folder template found for club ${club.club_id} (club_type=${clubTypeId}, year=${yearId})`,
    );
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
