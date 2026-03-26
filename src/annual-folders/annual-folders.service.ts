import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTemplateDto,
  CreateTemplateSectionDto,
  UpdateTemplateSectionDto,
  UploadEvidenceDto,
  UpdateEvidenceDto,
} from './dto';

@Injectable()
export class AnnualFoldersService {
  constructor(private readonly prisma: PrismaService) {}

  // ========================================
  // TEMPLATE MANAGEMENT (Admin)
  // ========================================

  /**
   * Create a folder template for a specific club type and ecclesiastical year.
   * The combination of club_type_id + ecclesiastical_year_id must be unique.
   */
  async createTemplate(dto: CreateTemplateDto) {
    const existing = await this.prisma.folder_templates.findUnique({
      where: {
        club_type_id_ecclesiastical_year_id: {
          club_type_id: dto.club_type_id,
          ecclesiastical_year_id: dto.ecclesiastical_year_id,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'A template already exists for this club type and ecclesiastical year',
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
  async addTemplateSection(
    templateId: string,
    dto: CreateTemplateSectionDto,
  ) {
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
        ...(dto.minimum_points !== undefined && { minimum_points: dto.minimum_points }),
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
   */
  async getTemplateByClubTypeAndYear(clubTypeId: number, yearId: number) {
    const template = await this.prisma.folder_templates.findUnique({
      where: {
        club_type_id_ecclesiastical_year_id: {
          club_type_id: clubTypeId,
          ecclesiastical_year_id: yearId,
        },
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

    // Get the enrollment with club section details
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      include: {
        club_section: {
          select: { club_type_id: true },
        },
      },
    });

    if (!enrollment) {
      throw new NotFoundException(
        `Club enrollment with ID ${enrollmentId} not found`,
      );
    }

    // Find the template for this club type + year
    const template = await this.prisma.folder_templates.findUnique({
      where: {
        club_type_id_ecclesiastical_year_id: {
          club_type_id: enrollment.club_section.club_type_id,
          ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
        },
      },
    });

    if (!template) {
      throw new NotFoundException(
        'No folder template found for this enrollment\'s club type and year',
      );
    }

    if (!template.active) {
      throw new BadRequestException(
        'The folder template for this enrollment is not active',
      );
    }

    return this.prisma.annual_folders.create({
      data: {
        club_enrollment_id: enrollmentId,
        folder_template_id: template.folder_template_id,
        status: 'open',
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
          },
          orderBy: { created_at: 'asc' },
        },
        evaluations: {
          include: {
            evaluated_by: {
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
          },
          orderBy: { created_at: 'asc' },
        },
        evaluations: {
          include: {
            evaluated_by: {
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
   */
  async uploadEvidence(
    folderId: string,
    sectionId: string,
    dto: UploadEvidenceDto,
    userId: string,
  ) {
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

    return this.prisma.annual_folder_evidences.create({
      data: {
        annual_folder_id: folderId,
        section_id: sectionId,
        file_url: dto.file_url,
        file_name: dto.file_name,
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
      throw new NotFoundException(
        `Evidence with ID ${evidenceId} not found`,
      );
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
      throw new NotFoundException(
        `Evidence with ID ${evidenceId} not found`,
      );
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
  // STATUS TRANSITIONS
  // ========================================

  /**
   * Submit a folder (change status from 'open' to 'submitted').
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
        uploaded_by: this.formatUserName(evidence.uploader),
        created_at: evidence.created_at,
      });
    }

    // Index evaluations by section_id for O(1) lookup
    const evaluationBySection = new Map<string, any>();
    for (const evaluation of (folder.evaluations ?? [])) {
      evaluationBySection.set(evaluation.section_id, {
        evaluation_id: evaluation.evaluation_id,
        earned_points: evaluation.earned_points,
        max_points: evaluation.max_points,
        notes: evaluation.notes,
        evaluator: this.formatUserName(evaluation.evaluated_by),
        evaluated_at: evaluation.evaluated_at,
      });
    }

    // Build sections with their evidences and evaluation (if present)
    const sections = folder.folder_template.sections.map((section: any) => ({
      section_id: section.section_id,
      name: section.name,
      description: section.description,
      order: section.order,
      required: section.required,
      max_points: section.max_points,
      minimum_points: section.minimum_points,
      evidences: evidencesBySection.get(section.section_id) ?? [],
      evidence_count: (evidencesBySection.get(section.section_id) ?? []).length,
      evaluation: evaluationBySection.get(section.section_id) ?? null,
    }));

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
