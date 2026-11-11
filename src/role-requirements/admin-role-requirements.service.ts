import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getAuditCorrelationId } from '../audit-logs/audit-request-context';
import { CriticalAuditWriterService } from '../audit-logs/critical-audit-writer.service';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateRoleRequirementDto } from './dto/update-role-requirement.dto';

const REQUIREMENT_SELECT = {
  requirement_id: true,
  requirement_type: true,
  mode: true,
  effective_from: true,
  equivalent_certification_id: true,
  active: true,
  modified_at: true,
  roles: { select: { role_id: true, role_name: true } },
  club_types: { select: { club_type_id: true, name: true } },
  certifications: { select: { certification_id: true, name: true } },
} satisfies Prisma.role_requirementsSelect;

type RequirementRow = Prisma.role_requirementsGetPayload<{
  select: typeof REQUIREMENT_SELECT;
}>;

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function toRequirementView(row: RequirementRow) {
  return {
    requirement_id: row.requirement_id,
    role: { role_id: row.roles.role_id, name: row.roles.role_name },
    club_type: row.club_types
      ? { club_type_id: row.club_types.club_type_id, name: row.club_types.name }
      : null,
    requirement_type: row.requirement_type,
    mode: row.mode,
    effective_from: dateOnly(row.effective_from),
    equivalent_certification: row.certifications
      ? {
          certification_id: row.certifications.certification_id,
          name: row.certifications.name,
        }
      : null,
    active: row.active,
    modified_at: row.modified_at.toISOString(),
  };
}

/**
 * Admin view of `role_requirements`. Changing `mode` / `effective_from` is how
 * a requirement goes from INFO to WARN or BLOCK; this service only exposes the
 * change (audited), it never decides when.
 */
@Injectable()
export class AdminRoleRequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: CriticalAuditWriterService,
  ) {}

  async list() {
    const rows = await this.prisma.role_requirements.findMany({
      where: { active: true },
      orderBy: [{ requirement_id: 'asc' }],
      select: REQUIREMENT_SELECT,
    });
    return { items: rows.map(toRequirementView) };
  }

  async update(
    actorId: string,
    requirementId: number,
    dto: UpdateRoleRequirementDto,
  ) {
    let effectiveFrom: Date | null | undefined;
    if (dto.effective_from === null) {
      effectiveFrom = null;
    } else if (dto.effective_from !== undefined) {
      effectiveFrom = new Date(`${dto.effective_from}T00:00:00.000Z`);
      if (
        Number.isNaN(effectiveFrom.getTime()) ||
        effectiveFrom.toISOString().slice(0, 10) !== dto.effective_from
      ) {
        throw new AppBadRequestException(
          ErrorCode.ROLE_REQUIREMENT_DATE_INVALID,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.role_requirements.findFirst({
        where: { requirement_id: requirementId, active: true },
        select: REQUIREMENT_SELECT,
      });
      if (!current) {
        throw new AppNotFoundException(ErrorCode.ROLE_REQUIREMENT_NOT_FOUND);
      }
      if (
        dto.equivalent_certification_id !== undefined &&
        dto.equivalent_certification_id !== null
      ) {
        const certification = await tx.certifications.findFirst({
          where: {
            certification_id: dto.equivalent_certification_id,
            active: true,
          },
          select: { certification_id: true },
        });
        if (!certification) {
          throw new AppBadRequestException(
            ErrorCode.ROLE_REQUIREMENT_CERTIFICATION_INVALID,
          );
        }
      }

      const data: Prisma.role_requirementsUncheckedUpdateInput = {};
      if (dto.mode !== undefined) data.mode = dto.mode;
      if (effectiveFrom !== undefined) data.effective_from = effectiveFrom;
      if (dto.equivalent_certification_id !== undefined) {
        data.equivalent_certification_id = dto.equivalent_certification_id;
      }
      if (Object.keys(data).length === 0) {
        return toRequirementView(current);
      }

      const updated = await tx.role_requirements.update({
        where: { requirement_id: requirementId },
        data,
        select: REQUIREMENT_SELECT,
      });
      const snapshot = (row: RequirementRow) => ({
        mode: row.mode,
        effective_from: dateOnly(row.effective_from),
        equivalent_certification_id: row.equivalent_certification_id,
      });
      await this.audit.write(tx, {
        entityType: 'role_requirements',
        entityId: String(requirementId),
        action: 'ROLE_REQUIREMENT_UPDATED',
        eventKey: `role-requirement:updated:${requirementId}:${randomUUID()}`,
        actor: { kind: 'user', userId: actorId, roleName: null, scope: {} },
        target: {
          userId: null,
          scope: {
            requirement_id: requirementId,
            role: current.roles.role_name,
            requirement_type: current.requirement_type,
          },
        },
        before: snapshot(current),
        after: snapshot(updated),
        summary: `Requisito ${current.requirement_type} del rol ${current.roles.role_name} actualizado`,
        correlationId: getAuditCorrelationId() ?? randomUUID(),
        result: 'succeeded',
      });
      return toRequirementView(updated);
    });
  }
}
