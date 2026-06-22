import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  annual_folder_section_status_enum,
  union_evaluation_decision_enum,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmUnionDto, EvaluateSectionDto } from './dto';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';

type EvaluationTerritoryMode = 'folder' | 'union';

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    @Optional()
    private readonly hierarchy?: InstitutionalHierarchyService,
  ) {}

  // ========================================
  // EVALUATE SECTION
  // ========================================

  /**
   * Evaluate a section of an annual evidence folder (LF action).
   * Rows are eagerly created in PENDING by T-B2-1; this method updates the
   * pre-existing row instead of creating one.  Status transitions:
   *   SUBMITTED → PREAPPROVED_LF  (when requires_union_confirmation=true)
   *   SUBMITTED → VALIDATED       (shortcut: requires_union_confirmation=false)
   * Recalculates folder totals after each evaluation.
   * Transitions folder status to "under_evaluation" on first LF action,
   * "evaluated" when all sections reach a terminal state (VALIDATED/REJECTED).
   */
  async evaluateSection(
    folderId: string,
    sectionId: string,
    dto: EvaluateSectionDto,
    evaluatorUserId: string,
  ) {
    await this.assertFolderEvaluationTerritoryAccess(
      folderId,
      evaluatorUserId,
      'folder',
    );

    return this.prisma.$transaction(async (tx) => {
      // Fetch folder with template sections
      const folder = await tx.annual_folders.findUnique({
        where: { annual_folder_id: folderId },
        select: {
          annual_folder_id: true,
          status: true,
          hierarchy_context_id: true,
          requires_union_confirmation: true,
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
          folder_template: {
            select: {
              sections: {
                select: {
                  section_id: true,
                  name: true,
                  max_points: true,
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

      // Validate folder status allows evaluation.
      // A folder can remain `open` while clubs submit sections incrementally;
      // the section evaluation row is the source of truth for review readiness.
      if (
        folder.status !== 'open' &&
        folder.status !== 'submitted' &&
        folder.status !== 'under_evaluation'
      ) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_STATUS_INVALID_FOR_EVALUATE,
          { status: folder.status },
        );
      }

      // Validate section belongs to folder's template
      const section = folder.folder_template.sections.find(
        (s) => s.section_id === sectionId,
      );

      if (!section) {
        throw new AppNotFoundException(
          ErrorCode.ANNUAL_FOLDER_SECTION_NOT_IN_TEMPLATE,
          { sectionId },
        );
      }

      // Validate earned_points does not exceed section max_points
      if (dto.earned_points > section.max_points) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_EARNED_POINTS_EXCEED_MAX,
          {
            earnedPoints: dto.earned_points,
            maxPoints: section.max_points,
          },
        );
      }

      // Fetch pre-existing row (created eagerly at folder creation by T-B2-1)
      const existingEval =
        await tx.annual_folder_section_evaluations.findUnique({
          where: {
            annual_folder_id_section_id: {
              annual_folder_id: folderId,
              section_id: sectionId,
            },
          },
        });

      if (!existingEval) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_EVAL_ROW_NOT_FOUND,
          { sectionId },
        );
      }

      // Guard: only SUBMITTED and PREAPPROVED_LF rows may be evaluated by LF
      if (existingEval.status === annual_folder_section_status_enum.PENDING) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_SECTION_PENDING,
          { sectionId },
        );
      }

      if (
        existingEval.status === annual_folder_section_status_enum.VALIDATED ||
        existingEval.status === annual_folder_section_status_enum.REJECTED
      ) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_SECTION_TERMINAL,
          {
            sectionId,
            status: existingEval.status,
          },
        );
      }

      // Compute new status based on union confirmation requirement
      const requiresUnion = folder.requires_union_confirmation;
      const newEvalStatus = requiresUnion
        ? annual_folder_section_status_enum.PREAPPROVED_LF
        : annual_folder_section_status_enum.VALIDATED;

      // Build write payload; mirror union columns when shortcut path applies
      const now = new Date();
      const updateData: Record<string, unknown> = {
        earned_points: dto.earned_points,
        max_points: section.max_points,
        notes: dto.notes ?? null,
        lf_approved_by: evaluatorUserId,
        lf_approved_at: now,
        status: newEvalStatus,
      };

      if (!requiresUnion) {
        // ADR-3 shortcut path: mirror union approval with the LF actor
        updateData.union_approved_by = evaluatorUserId;
        updateData.union_approved_at = now;
        updateData.union_decision = union_evaluation_decision_enum.APPROVED;
      }

      // Update evaluation record (row guaranteed to exist)
      const evaluation = await tx.annual_folder_section_evaluations.update({
        where: {
          annual_folder_id_section_id: {
            annual_folder_id: folderId,
            section_id: sectionId,
          },
        },
        data: updateData,
        include: {
          section: { select: { section_id: true, name: true } },
          lf_approver: {
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

      // Determine new folder status.
      // Only terminal-decision rows (VALIDATED or REJECTED) count as "evaluated".
      // PENDING / SUBMITTED / PREAPPROVED_LF rows are not yet decided and must NOT
      // count — otherwise folders created with eager PENDING rows (T-B2-1) would
      // auto-advance to `evaluated` immediately after the first real evaluation.
      const decidedEvaluations =
        await tx.annual_folder_section_evaluations.findMany({
          where: {
            annual_folder_id: folderId,
            status: {
              in: [
                annual_folder_section_status_enum.VALIDATED,
                annual_folder_section_status_enum.REJECTED,
              ],
            },
          },
        });
      const totalSections = folder.folder_template.sections.length;
      const evaluatedSections = decidedEvaluations.length;

      let newFolderStatus = folder.status;
      let evaluatedAt: Date | undefined;

      if (folder.status === 'submitted') {
        newFolderStatus = 'under_evaluation';
      }

      if (evaluatedSections >= totalSections && totalSections > 0) {
        newFolderStatus = 'evaluated';
        evaluatedAt = new Date();
      }

      const hierarchyContextId =
        newFolderStatus === 'evaluated'
          ? await this.resolveSnapshotContextIdForFolder({
              clubId:
                folder.club_enrollment?.club_section?.clubs?.club_id ?? null,
              existingHierarchyContextId: folder.hierarchy_context_id ?? null,
              asOf: evaluatedAt ?? new Date(),
              actorUserId: evaluatorUserId,
            })
          : undefined;

      // Update folder status if it changed
      const updatedFolder = await tx.annual_folders.update({
        where: { annual_folder_id: folderId },
        data: {
          status: newFolderStatus,
          ...(evaluatedAt !== undefined && { evaluated_at: evaluatedAt }),
          ...(hierarchyContextId !== undefined && {
            hierarchy_context_id: hierarchyContextId,
          }),
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
  // CONFIRM UNION
  // ========================================

  /**
   * Union-tier second step of the review flow.
   * Preconditions:
   *   - folder.requires_union_confirmation === true
   *   - evaluation.status === PREAPPROVED_LF
   * Transitions:
   *   PREAPPROVED_LF + APPROVED  → VALIDATED
   *   PREAPPROVED_LF + REJECTED_OVERRIDE → REJECTED
   * LF columns (lf_approved_by, lf_approved_at) are intentionally preserved.
   */
  async confirmUnion(
    folderId: string,
    sectionId: string,
    dto: ConfirmUnionDto,
    actorUserId: string,
  ) {
    await this.assertFolderEvaluationTerritoryAccess(
      folderId,
      actorUserId,
      'union',
    );

    // ── Role check (Option B — service-layer enforcement) ──────────────────
    // Only director-union and assistant-union may confirm evaluations at the
    // union tier. This check runs outside the transaction because it queries a
    // separate table and does not require transactional isolation.
    const actorRoles = await this.prisma.users_roles.findMany({
      where: { user_id: actorUserId, active: true },
      include: { roles: { select: { role_name: true } } },
    });

    const actorRoleNames = new Set(actorRoles.map((ur) => ur.roles.role_name));

    const UNION_TIER_ROLES = ['director-union', 'assistant-union'];
    const hasUnionRole = UNION_TIER_ROLES.some((r) => actorRoleNames.has(r));

    if (!hasUnionRole) {
      throw new AppForbiddenException(
        ErrorCode.ANNUAL_FOLDER_UNION_ROLE_REQUIRED,
      );
    }
    // ──────────────────────────────────────────────────────────────────────

    return this.prisma.$transaction(async (tx) => {
      // Load folder
      const folder = await tx.annual_folders.findUnique({
        where: { annual_folder_id: folderId },
        select: {
          annual_folder_id: true,
          status: true,
          hierarchy_context_id: true,
          requires_union_confirmation: true,
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
          folder_template: {
            select: {
              sections: {
                select: {
                  section_id: true,
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

      // Precondition: folder must require union confirmation
      if (!folder.requires_union_confirmation) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_UNION_CONFIRMATION_NOT_REQUIRED,
        );
      }

      // Load the evaluation row
      const existingEval =
        await tx.annual_folder_section_evaluations.findUnique({
          where: {
            annual_folder_id_section_id: {
              annual_folder_id: folderId,
              section_id: sectionId,
            },
          },
        });

      if (!existingEval) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_EVAL_ROW_NOT_FOUND,
          { sectionId },
        );
      }

      // Precondition: evaluation must be in PREAPPROVED_LF
      if (
        existingEval.status !== annual_folder_section_status_enum.PREAPPROVED_LF
      ) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_SECTION_NOT_PREAPPROVED,
          { status: existingEval.status },
        );
      }

      // Defensive sanity check: LF fields must be populated
      if (!existingEval.lf_approved_at || !existingEval.lf_approved_by) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_SECTION_MISSING_LF_DATA,
          { sectionId },
        );
      }

      // Compute new status
      const newStatus =
        dto.decision === union_evaluation_decision_enum.APPROVED
          ? annual_folder_section_status_enum.VALIDATED
          : annual_folder_section_status_enum.REJECTED;

      // Build write payload — LF columns NOT touched
      const now = new Date();
      const updateData: Record<string, unknown> = {
        union_approved_by: actorUserId,
        union_approved_at: now,
        union_decision: dto.decision,
        status: newStatus,
        ...(dto.decision === union_evaluation_decision_enum.REJECTED_OVERRIDE
          ? { earned_points: 0 }
          : {}),
        // Preserve existing notes when dto.notes is not explicitly provided
        notes: dto.notes !== undefined ? dto.notes : existingEval.notes,
      };

      // Update evaluation record
      const evaluation = await tx.annual_folder_section_evaluations.update({
        where: {
          annual_folder_id_section_id: {
            annual_folder_id: folderId,
            section_id: sectionId,
          },
        },
        data: updateData,
        include: {
          section: { select: { section_id: true, name: true } },
          lf_approver: {
            select: {
              name: true,
              paternal_last_name: true,
              maternal_last_name: true,
            },
          },
        },
      });

      // Recalculate folder totals. Only VALIDATED rows contribute points;
      // REJECTED rows are terminal for workflow but contribute 0 to score.
      await this.recalcFolderTotals(folderId, tx);

      // Determine new folder status (mirror evaluateSection logic)
      const decidedEvaluations =
        await tx.annual_folder_section_evaluations.findMany({
          where: {
            annual_folder_id: folderId,
            status: {
              in: [
                annual_folder_section_status_enum.VALIDATED,
                annual_folder_section_status_enum.REJECTED,
              ],
            },
          },
        });

      const totalSections = folder.folder_template.sections.length;
      const evaluatedSections = decidedEvaluations.length;

      let newFolderStatus = folder.status;
      let evaluatedAt: Date | undefined;

      if (evaluatedSections >= totalSections && totalSections > 0) {
        newFolderStatus = 'evaluated';
        evaluatedAt = new Date();
      }

      const hierarchyContextId =
        newFolderStatus === 'evaluated'
          ? await this.resolveSnapshotContextIdForFolder({
              clubId:
                folder.club_enrollment?.club_section?.clubs?.club_id ?? null,
              existingHierarchyContextId: folder.hierarchy_context_id ?? null,
              asOf: evaluatedAt ?? new Date(),
              actorUserId: actorUserId,
            })
          : undefined;

      const updatedFolder = await tx.annual_folders.update({
        where: { annual_folder_id: folderId },
        data: {
          status: newFolderStatus,
          ...(evaluatedAt !== undefined && { evaluated_at: evaluatedAt }),
          ...(hierarchyContextId !== undefined && {
            hierarchy_context_id: hierarchyContextId,
          }),
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
    actorUserId: string,
  ) {
    await this.assertFolderEvaluationTerritoryAccess(
      folderId,
      actorUserId,
      'folder',
    );

    return this.prisma.$transaction(async (tx) => {
      // Validate folder exists
      const folder = await tx.annual_folders.findUnique({
        where: { annual_folder_id: folderId },
      });

      if (!folder) {
        throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
          id: folderId,
        });
      }

      // Validate folder status allows reopening.
      // Sections can be evaluated while the folder remains `open`, so they
      // must also be reopenable in that same incremental-review state.
      if (
        folder.status !== 'open' &&
        folder.status !== 'under_evaluation' &&
        folder.status !== 'evaluated'
      ) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_STATUS_INVALID_FOR_REOPEN,
          { status: folder.status },
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
        throw new AppNotFoundException(
          ErrorCode.ANNUAL_FOLDER_EVAL_ROW_NOT_FOUND,
          { sectionId },
        );
      }

      // Guard: cannot reopen a row already in PENDING or SUBMITTED
      const reopenableStatuses: annual_folder_section_status_enum[] = [
        annual_folder_section_status_enum.VALIDATED,
        annual_folder_section_status_enum.REJECTED,
        annual_folder_section_status_enum.PREAPPROVED_LF,
      ];
      if (!reopenableStatuses.includes(existing.status)) {
        throw new AppBadRequestException(
          ErrorCode.ANNUAL_FOLDER_SECTION_NOT_REOPENABLE,
          { status: existing.status },
        );
      }

      this.logger.log(
        `reopenSection: actor=${actorUserId} folder=${folderId} section=${sectionId} prev_status=${existing.status}`,
      );

      // Reset the evaluation row to a fresh SUBMITTED state
      await tx.annual_folder_section_evaluations.update({
        where: {
          annual_folder_id_section_id: {
            annual_folder_id: folderId,
            section_id: sectionId,
          },
        },
        data: {
          status: annual_folder_section_status_enum.SUBMITTED,
          lf_approved_by: null,
          lf_approved_at: null,
          union_approved_by: null,
          union_approved_at: null,
          union_decision: null,
          earned_points: 0,
          notes: null,
        },
      });

      // Recalculate folder totals (section no longer contributes earned points)
      await this.recalcFolderTotals(folderId, tx);

      // Transition folder status back if it was "evaluated"
      const newStatus =
        folder.status === 'evaluated' ? 'under_evaluation' : folder.status;

      const updatedFolder = await tx.annual_folders.update({
        where: { annual_folder_id: folderId },
        data: {
          status: newStatus,
          ...(folder.status === 'evaluated' && { evaluated_at: null }),
          ...(folder.hierarchy_context_id !== null && {
            hierarchy_context_id: null,
          }),
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
        message: 'Section evaluation reopened successfully',
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
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
        id: folderId,
      });
    }

    const evaluations =
      await this.prisma.annual_folder_section_evaluations.findMany({
        where: { annual_folder_id: folderId },
        include: {
          section: { select: { section_id: true, name: true, order: true } },
          lf_approver: {
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

  private async assertFolderEvaluationTerritoryAccess(
    folderId: string,
    actorUserId: string,
    mode: EvaluationTerritoryMode,
  ): Promise<void> {
    const folder = await this.prisma.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
      select: {
        club_enrollment: {
          select: {
            club_section: {
              select: {
                clubs: {
                  select: {
                    local_field_id: true,
                    local_fields: {
                      select: {
                        union_id: true,
                        unions: {
                          select: {
                            division_id: true,
                            country_id: true,
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
      },
    });

    if (!folder) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
        id: folderId,
      });
    }

    const club = folder.club_enrollment?.club_section?.clubs;
    const localField = club?.local_fields;

    if (!club?.local_field_id || !localField?.union_id) {
      throw new AppNotFoundException(
        ErrorCode.ANNUAL_FOLDER_EVIDENCE_CLUB_NOT_RESOLVED,
        { folderId },
      );
    }

    const resolved =
      await this.authorizationContext.resolveUserAuthorization(actorUserId);
    const scope =
      mode === 'union'
        ? {
            union_id: localField.union_id,
            division_id: localField.unions?.division_id ?? null,
            country_id: localField.unions?.country_id ?? null,
          }
        : {
            local_field_id: club.local_field_id,
            union_id: localField.union_id,
            division_id: localField.unions?.division_id ?? null,
            country_id: localField.unions?.country_id ?? null,
          };

    if (
      this.authorizationContext.canAccessHierarchyScope(
        resolved,
        scope,
        'current-write',
      )
    ) {
      return;
    }

    throw new AppForbiddenException(
      ErrorCode.ANNUAL_FOLDER_EVIDENCE_TERRITORY_DENIED,
    );
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
    // Only sum earned_points from VALIDATED rows.
    // REJECTED rows are terminal for workflow, but they must not inflate score.
    // Rows in PENDING / SUBMITTED / PREAPPROVED_LF have no confirmed score yet
    // and must not inflate the earned total once T-B2-1 creates eager PENDING rows.
    const evaluations = await tx.annual_folder_section_evaluations.findMany({
      where: {
        annual_folder_id: folderId,
        status: annual_folder_section_status_enum.VALIDATED,
      },
      select: { earned_points: true },
    });

    // Get all sections for the folder's template to compute total max_points
    const folder = await tx.annual_folders.findUnique({
      where: { annual_folder_id: folderId },
      select: { folder_template_id: true },
    });

    if (!folder) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_FOLDER_NOT_FOUND, {
        id: folderId,
      });
    }

    const sections = await tx.folder_template_sections.findMany({
      where: { folder_template_id: folder.folder_template_id },
      select: { max_points: true },
    });

    const total_earned_points = evaluations.reduce(
      (sum, e) => sum + e.earned_points,
      0,
    );
    const total_max_points = sections.reduce((sum, s) => sum + s.max_points, 0);
    const progress_percentage =
      total_max_points > 0 ? (total_earned_points / total_max_points) * 100 : 0;

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

  private async resolveSnapshotContextIdForFolder(input: {
    clubId: number | null;
    existingHierarchyContextId: string | null;
    asOf: Date;
    actorUserId: string;
  }): Promise<string | undefined> {
    if (input.existingHierarchyContextId) {
      return input.existingHierarchyContextId;
    }

    if (!this.hierarchy || input.clubId == null) {
      return undefined;
    }

    const snapshot = await this.hierarchy
      .snapshotForClub(input.clubId, input.asOf, input.actorUserId)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Unable to persist hierarchy snapshot for annual evidence folder club=${input.clubId}: ${message}`,
        );
        return null;
      });

    return snapshot?.hierarchy_context_id ?? undefined;
  }

  private formatEvaluation(evaluation: any) {
    return {
      evaluation_id: evaluation.evaluation_id,
      section_id: evaluation.section_id,
      section_name: evaluation.section?.name ?? null,
      section_order: evaluation.section?.order ?? null,
      earned_points: evaluation.earned_points,
      max_points: evaluation.max_points,
      notes: evaluation.notes,
      evaluator: this.formatUserName(evaluation.lf_approver),
      lf_approved_at: evaluation.lf_approved_at,
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
