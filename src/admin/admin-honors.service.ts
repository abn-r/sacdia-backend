import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  BatchReviewDto,
  CreateRequirementDto,
  ReorderRequirementsDto,
  UpdateRequirementDto,
} from '../honors/dto/honor-requirements.dto';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type RawRequirement = {
  requirement_id: number;
  honor_id: number;
  parent_id: number | null;
  requirement_number: number;
  display_label: string | null;
  requirement_text: string;
  reference_text: string | null;
  has_sub_items: boolean;
  is_choice_group: boolean;
  choice_min: number | null;
  requires_evidence: boolean;
  needs_review: boolean;
  active: boolean;
  created_at: Date;
  modified_at: Date;
};

type RequirementNode = RawRequirement & { children: RequirementNode[] };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AdminHonorsService {
  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  /** Builds a nested tree from a flat list of requirements. */
  private buildTree(rows: RawRequirement[]): RequirementNode[] {
    const map = new Map<number, RequirementNode>();

    for (const row of rows) {
      map.set(row.requirement_id, { ...row, children: [] });
    }

    const roots: RequirementNode[] = [];

    for (const node of map.values()) {
      if (node.parent_id === null) {
        roots.push(node);
      } else {
        const parent = map.get(node.parent_id);
        if (parent) {
          parent.children.push(node);
        } else {
          // Orphaned sub-item (parent was soft-deleted) — surface at root level.
          roots.push(node);
        }
      }
    }

    // Sort each level by requirement_number.
    const sort = (nodes: RequirementNode[]) => {
      nodes.sort((a, b) => a.requirement_number - b.requirement_number);
      for (const n of nodes) sort(n.children);
    };
    sort(roots);

    return roots;
  }

  // =========================================================================
  // PUBLIC METHODS
  // =========================================================================

  /**
   * Returns the full hierarchical requirements tree for an honor.
   * Includes all admin flags. Only active requirements are returned.
   */
  async getRequirements(honorId: number) {
    const honor = await this.prisma.honors.findUnique({
      where: { honor_id: honorId },
      select: { honor_id: true },
    });

    if (!honor) {
      throw new AppNotFoundException(ErrorCode.ADMIN_HONOR_NOT_FOUND, {
        id: honorId,
      });
    }

    const rows = await this.prisma.honor_requirements.findMany({
      where: { honor_id: honorId, active: true },
      orderBy: { requirement_number: 'asc' },
    });

    return this.buildTree(rows as RawRequirement[]);
  }

  /**
   * Creates a new requirement. Validates honor existence, parent ownership,
   * and choice-group constraints.
   */
  async createRequirement(dto: CreateRequirementDto) {
    // Validate honor exists.
    const honor = await this.prisma.honors.findUnique({
      where: { honor_id: dto.honorId },
      select: { honor_id: true },
    });

    if (!honor) {
      throw new AppNotFoundException(ErrorCode.ADMIN_HONOR_NOT_FOUND, {
        id: dto.honorId,
      });
    }

    // Validate parent belongs to same honor.
    if (dto.parentId != null) {
      const parent = await this.prisma.honor_requirements.findUnique({
        where: { requirement_id: dto.parentId },
        select: { requirement_id: true, honor_id: true, active: true },
      });

      if (!parent || !parent.active) {
        throw new AppNotFoundException(
          ErrorCode.ADMIN_HONOR_REQUIREMENT_NOT_FOUND,
          { id: dto.parentId },
        );
      }

      if (parent.honor_id !== dto.honorId) {
        throw new AppBadRequestException(
          ErrorCode.ADMIN_HONOR_REQUIREMENT_WRONG_HONOR,
          { parentId: dto.parentId, honorId: dto.honorId },
        );
      }
    }

    // Validate choice-group constraints.
    if (dto.isChoiceGroup && dto.choiceMin == null) {
      throw new AppBadRequestException(
        ErrorCode.ADMIN_HONOR_REQUIREMENT_CHOICE_MIN_REQUIRED,
      );
    }

    // Create requirement and update parent's has_sub_items in a transaction.
    return this.prisma.$transaction(async (tx) => {
      const requirement = await tx.honor_requirements.create({
        data: {
          honor_id: dto.honorId,
          parent_id: dto.parentId ?? null,
          requirement_number: dto.requirementNumber,
          display_label: dto.displayLabel ?? null,
          requirement_text: dto.requirementText,
          reference_text: dto.referenceText ?? null,
          has_sub_items: false,
          is_choice_group: dto.isChoiceGroup ?? false,
          choice_min: dto.choiceMin ?? null,
          requires_evidence: dto.requiresEvidence ?? false,
        },
      });

      // Mark parent as having sub-items.
      if (dto.parentId != null) {
        await tx.honor_requirements.update({
          where: { requirement_id: dto.parentId },
          data: { has_sub_items: true, modified_at: new Date() },
        });
      }

      return requirement;
    });
  }

  /**
   * Partially updates a requirement. Validates it exists.
   */
  async updateRequirement(requirementId: number, dto: UpdateRequirementDto) {
    const existing = await this.prisma.honor_requirements.findUnique({
      where: { requirement_id: requirementId },
      select: { requirement_id: true, active: true },
    });

    if (!existing || !existing.active) {
      throw new AppNotFoundException(
        ErrorCode.ADMIN_HONOR_REQUIREMENT_NOT_FOUND,
        { id: requirementId },
      );
    }

    return this.prisma.honor_requirements.update({
      where: { requirement_id: requirementId },
      data: {
        ...(dto.requirementNumber !== undefined && {
          requirement_number: dto.requirementNumber,
        }),
        ...(dto.displayLabel !== undefined && {
          display_label: dto.displayLabel,
        }),
        ...(dto.requirementText !== undefined && {
          requirement_text: dto.requirementText,
        }),
        ...(dto.referenceText !== undefined && {
          reference_text: dto.referenceText,
        }),
        ...(dto.hasSubItems !== undefined && {
          has_sub_items: dto.hasSubItems,
        }),
        ...(dto.isChoiceGroup !== undefined && {
          is_choice_group: dto.isChoiceGroup,
        }),
        ...(dto.choiceMin !== undefined && { choice_min: dto.choiceMin }),
        ...(dto.requiresEvidence !== undefined && {
          requires_evidence: dto.requiresEvidence,
        }),
        ...(dto.needsReview !== undefined && { needs_review: dto.needsReview }),
        modified_at: new Date(),
      },
    });
  }

  /**
   * Soft-deletes a requirement (sets active=false). Also soft-deletes any
   * direct children so orphaned sub-items are not surfaced to users.
   */
  async deleteRequirement(requirementId: number) {
    const existing = await this.prisma.honor_requirements.findUnique({
      where: { requirement_id: requirementId },
      select: { requirement_id: true, active: true },
    });

    if (!existing || !existing.active) {
      throw new AppNotFoundException(
        ErrorCode.ADMIN_HONOR_REQUIREMENT_NOT_FOUND,
        { id: requirementId },
      );
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // Soft-delete children.
      await tx.honor_requirements.updateMany({
        where: { parent_id: requirementId, active: true },
        data: { active: false, modified_at: now },
      });

      // Soft-delete the requirement itself.
      return tx.honor_requirements.update({
        where: { requirement_id: requirementId },
        data: { active: false, modified_at: now },
      });
    });
  }

  /**
   * Batch-updates requirement_number based on the position of each ID in the
   * provided array. Uses a transaction for atomicity.
   */
  async reorderRequirements(honorId: number, dto: ReorderRequirementsDto) {
    // Validate honor exists.
    const honor = await this.prisma.honors.findUnique({
      where: { honor_id: honorId },
      select: { honor_id: true },
    });

    if (!honor) {
      throw new AppNotFoundException(ErrorCode.ADMIN_HONOR_NOT_FOUND, {
        id: honorId,
      });
    }

    const now = new Date();

    await this.prisma.$transaction(
      dto.requirementIds.map((id, index) =>
        this.prisma.honor_requirements.update({
          where: { requirement_id: id },
          data: { requirement_number: index + 1, modified_at: now },
        }),
      ),
    );

    return { reordered: dto.requirementIds.length };
  }

  /**
   * Returns a paginated list of requirements with needs_review=true, including
   * the honor name for each requirement.
   */
  async getPendingReview(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.honor_requirements.findMany({
        where: { needs_review: true, active: true },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          honors: {
            select: { honor_id: true, name: true },
          },
        },
      }),
      this.prisma.honor_requirements.count({
        where: { needs_review: true, active: true },
      }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Batch-marks requirements as reviewed. For both approved and rejected cases
   * the admin has reviewed them, so needs_review is set to false.
   */
  async batchReview(dto: BatchReviewDto) {
    const updated = await this.prisma.honor_requirements.updateMany({
      where: {
        requirement_id: { in: dto.requirementIds },
        active: true,
      },
      data: {
        needs_review: false,
        modified_at: new Date(),
      },
    });

    return {
      reviewed: updated.count,
      approved: dto.approved,
      requirementIds: dto.requirementIds,
    };
  }
}
