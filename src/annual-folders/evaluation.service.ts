import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvaluateSectionDto } from './dto';

@Injectable()
export class EvaluationService {
  constructor(private readonly prisma: PrismaService) {}

  // ========================================
  // EVALUATE SECTION
  // ========================================

  /**
   * Evaluate a section of an annual folder.
   * Creates or updates the evaluation record (upsert on unique [annual_folder_id, section_id]).
   * Recalculates folder totals after each evaluation.
   * Transitions folder status to "under_evaluation" on first eval, "evaluated" when all sections done.
   */
  async evaluateSection(
    folderId: string,
    sectionId: string,
    dto: EvaluateSectionDto,
    evaluatorUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Fetch folder with template sections
      const folder = await tx.annual_folders.findUnique({
        where: { annual_folder_id: folderId },
        include: {
          folder_template: {
            include: {
              sections: true,
            },
          },
        },
      });

      if (!folder) {
        throw new NotFoundException(
          `Annual folder with ID ${folderId} not found`,
        );
      }

      // Validate folder status allows evaluation
      if (folder.status !== 'submitted' && folder.status !== 'under_evaluation') {
        throw new BadRequestException(
          `Cannot evaluate a folder with status '${folder.status}'. Folder must be 'submitted' or 'under_evaluation'.`,
        );
      }

      // Validate section belongs to folder's template
      const section = folder.folder_template.sections.find(
        (s) => s.section_id === sectionId,
      );

      if (!section) {
        throw new NotFoundException(
          `Section ${sectionId} does not belong to this folder's template`,
        );
      }

      // Validate earned_points does not exceed section max_points
      if (dto.earned_points > section.max_points) {
        throw new BadRequestException(
          `earned_points (${dto.earned_points}) cannot exceed section max_points (${section.max_points})`,
        );
      }

      // Upsert evaluation record
      const evaluation = await tx.annual_folder_section_evaluations.upsert({
        where: {
          annual_folder_id_section_id: {
            annual_folder_id: folderId,
            section_id: sectionId,
          },
        },
        update: {
          earned_points: dto.earned_points,
          max_points: section.max_points,
          notes: dto.notes ?? null,
          evaluated_by_id: evaluatorUserId,
          evaluated_at: new Date(),
        },
        create: {
          annual_folder_id: folderId,
          section_id: sectionId,
          earned_points: dto.earned_points,
          max_points: section.max_points,
          notes: dto.notes ?? null,
          evaluated_by_id: evaluatorUserId,
          evaluated_at: new Date(),
        },
        include: {
          section: { select: { section_id: true, name: true } },
          evaluated_by: {
            select: {
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
        },
      });

      // Recalculate folder totals
      await this.recalcFolderTotals(folderId, tx);

      // Determine new status
      const allEvaluations = await tx.annual_folder_section_evaluations.findMany({
        where: { annual_folder_id: folderId },
      });
      const totalSections = folder.folder_template.sections.length;
      const evaluatedSections = allEvaluations.length;

      let newStatus = folder.status;
      let evaluatedAt: Date | undefined;

      if (folder.status === 'submitted') {
        newStatus = 'under_evaluation';
      }

      if (evaluatedSections >= totalSections && totalSections > 0) {
        newStatus = 'evaluated';
        evaluatedAt = new Date();
      }

      // Update folder status if it changed
      const updatedFolder = await tx.annual_folders.update({
        where: { annual_folder_id: folderId },
        data: {
          status: newStatus,
          ...(evaluatedAt !== undefined && { evaluated_at: evaluatedAt }),
        },
        select: {
          annual_folder_id: true,
          status: true,
          total_earned_points: true,
          total_max_points: true,
          progress_percentage: true,
          evaluated_at: true,
        },
      });

      return {
        evaluation: this.formatEvaluation(evaluation),
        folder_summary: updatedFolder,
      };
    });
  }

  // ========================================
  // REOPEN SECTION
  // ========================================

  /**
   * Reopen a section for re-evaluation by deleting the existing evaluation record.
   * Recalculates folder totals and transitions folder back to "under_evaluation" if it was "evaluated".
   */
  async reopenSection(
    folderId: string,
    sectionId: string,
    _evaluatorUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Validate folder exists
      const folder = await tx.annual_folders.findUnique({
        where: { annual_folder_id: folderId },
      });

      if (!folder) {
        throw new NotFoundException(
          `Annual folder with ID ${folderId} not found`,
        );
      }

      // Validate folder status allows reopening
      if (folder.status !== 'under_evaluation' && folder.status !== 'evaluated') {
        throw new BadRequestException(
          `Cannot reopen a section in a folder with status '${folder.status}'. Folder must be 'under_evaluation' or 'evaluated'.`,
        );
      }

      // Find the existing evaluation
      const existing = await tx.annual_folder_section_evaluations.findUnique({
        where: {
          annual_folder_id_section_id: {
            annual_folder_id: folderId,
            section_id: sectionId,
          },
        },
      });

      if (!existing) {
        throw new NotFoundException(
          `No evaluation found for section ${sectionId} in this folder`,
        );
      }

      // Delete the evaluation
      await tx.annual_folder_section_evaluations.delete({
        where: {
          annual_folder_id_section_id: {
            annual_folder_id: folderId,
            section_id: sectionId,
          },
        },
      });

      // Recalculate folder totals
      await this.recalcFolderTotals(folderId, tx);

      // Transition folder status back if it was "evaluated"
      const newStatus =
        folder.status === 'evaluated' ? 'under_evaluation' : folder.status;

      const updatedFolder = await tx.annual_folders.update({
        where: { annual_folder_id: folderId },
        data: {
          status: newStatus,
          ...(folder.status === 'evaluated' && { evaluated_at: null }),
        },
        select: {
          annual_folder_id: true,
          status: true,
          total_earned_points: true,
          total_max_points: true,
          progress_percentage: true,
          evaluated_at: true,
        },
      });

      return {
        message: 'Section evaluation removed successfully',
        folder_summary: updatedFolder,
      };
    });
  }

  // ========================================
  // GET FOLDER EVALUATIONS
  // ========================================

  /**
   * Get all evaluations for a folder with evaluator name and section name.
   */
  async getFolderEvaluations(folderId: string) {
    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
    });

    if (!folder) {
      throw new NotFoundException(
        `Annual folder with ID ${folderId} not found`,
      );
    }

    const evaluations = await this.prisma.annual_folder_section_evaluations.findMany({
      where: { annual_folder_id: folderId },
      include: {
        section: { select: { section_id: true, name: true, order: true } },
        evaluated_by: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: { section: { order: 'asc' } },
    });

    return evaluations.map((e) => this.formatEvaluation(e));
  }

  // ========================================
  // SHARED: RECALCULATE FOLDER TOTALS
  // ========================================

  /**
   * Recalculates and persists total_earned_points, total_max_points, and progress_percentage
   * for the given folder based on current evaluation records.
   *
   * CRITICAL: Called within a transaction — pass the tx client.
   * Reused by the rankings module.
   */
  async recalcFolderTotals(
    folderId: string,
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ) {
    // Get all evaluations for this folder
    const evaluations = await tx.annual_folder_section_evaluations.findMany({
      where: { annual_folder_id: folderId },
      select: { earned_points: true },
    });

    // Get all sections for the folder's template to compute total max_points
    const folder = await tx.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
      select: { folder_template_id: true },
    });

    if (!folder) {
      throw new NotFoundException(`Annual folder ${folderId} not found`);
    }

    const sections = await tx.folder_template_sections.findMany({
      where: { folder_template_id: folder.folder_template_id },
      select: { max_points: true },
    });

    const total_earned_points = evaluations.reduce(
      (sum, e) => sum + e.earned_points,
      0,
    );
    const total_max_points = sections.reduce(
      (sum, s) => sum + s.max_points,
      0,
    );
    const progress_percentage =
      total_max_points > 0
        ? (total_earned_points / total_max_points) * 100
        : 0;

    await tx.annual_folders.update({
      where: { annual_folder_id: folderId },
      data: {
        total_earned_points,
        total_max_points,
        progress_percentage,
      },
    });

    return { total_earned_points, total_max_points, progress_percentage };
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  private formatEvaluation(evaluation: any) {
    return {
      evaluation_id: evaluation.evaluation_id,
      section_id: evaluation.section_id,
      section_name: evaluation.section?.name ?? null,
      section_order: evaluation.section?.order ?? null,
      earned_points: evaluation.earned_points,
      max_points: evaluation.max_points,
      notes: evaluation.notes,
      evaluator: this.formatUserName(evaluation.evaluated_by),
      evaluated_at: evaluation.evaluated_at,
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
