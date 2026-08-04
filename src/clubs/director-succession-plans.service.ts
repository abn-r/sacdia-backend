import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

export type ScheduleDirectorSuccessionInput = {
  clubSectionId: number;
  outgoingAssignmentId: string;
  successorUserId: string;
  targetEcclesiasticalYearId: number;
  scheduledById: string;
  scheduledByRole: string;
  scheduledLocalFieldId: number;
  idempotencyKey: string;
};

export type DirectorSuccessionPlanView = {
  succession_id: string;
  club_section_id: number;
  outgoing_assignment_id: string;
  successor_user_id: string;
  target_ecclesiastical_year_id: number;
  status: string;
  idempotency_key: string;
  request_hash: string;
  scheduled_by_id: string;
  effective_date?: Date;
  scheduled_by_role?: string;
  scheduled_local_field_id?: number;
};

const planSelect = {
  succession_id: true,
  club_section_id: true,
  outgoing_assignment_id: true,
  successor_user_id: true,
  target_ecclesiastical_year_id: true,
  status: true,
  idempotency_key: true,
  request_hash: true,
  scheduled_by_id: true,
  effective_date: true,
  scheduled_by_role: true,
  scheduled_local_field_id: true,
} as const;

/**
 * Durable schedule/read for director succession plans.
 * Does not activate successors or mutate club_role_assignments.
 */
@Injectable()
export class DirectorSuccessionPlansService {
  constructor(private readonly prisma: PrismaService) {}

  static hashSchedulePayload(
    input: Pick<
      ScheduleDirectorSuccessionInput,
      | 'clubSectionId'
      | 'outgoingAssignmentId'
      | 'successorUserId'
      | 'targetEcclesiasticalYearId'
    >,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          clubSectionId: input.clubSectionId,
          outgoingAssignmentId: input.outgoingAssignmentId,
          successorUserId: input.successorUserId,
          targetEcclesiasticalYearId: input.targetEcclesiasticalYearId,
        }),
      )
      .digest('hex');
  }

  async schedule(
    input: ScheduleDirectorSuccessionInput,
  ): Promise<DirectorSuccessionPlanView> {
    const requestHash =
      DirectorSuccessionPlansService.hashSchedulePayload(input);

    return this.prisma.$transaction(async (tx) => {
      const byKey = await tx.director_succession_plans.findFirst({
        where: {
          scheduled_by_id: input.scheduledById,
          idempotency_key: input.idempotencyKey,
        },
        select: planSelect,
      });

      if (byKey) {
        if (byKey.request_hash !== requestHash) {
          throw new AppConflictException(ErrorCode.IDEMPOTENCY_KEY_REUSED);
        }
        return byKey;
      }

      const year = await tx.ecclesiastical_years.findUnique({
        where: { year_id: input.targetEcclesiasticalYearId },
        select: { year_id: true, start_date: true },
      });
      if (!year) {
        throw new AppNotFoundException(ErrorCode.RECORD_NOT_FOUND);
      }

      return tx.director_succession_plans.create({
        data: {
          club_section_id: input.clubSectionId,
          outgoing_assignment_id: input.outgoingAssignmentId,
          successor_user_id: input.successorUserId,
          target_ecclesiastical_year_id: input.targetEcclesiasticalYearId,
          effective_date: year.start_date,
          scheduled_by_id: input.scheduledById,
          scheduled_by_role: input.scheduledByRole,
          scheduled_local_field_id: input.scheduledLocalFieldId,
          idempotency_key: input.idempotencyKey,
          request_hash: requestHash,
        },
        select: planSelect,
      });
    });
  }

  async getBySection(
    clubSectionId: number,
  ): Promise<DirectorSuccessionPlanView | null> {
    return this.prisma.director_succession_plans.findFirst({
      where: { club_section_id: clubSectionId },
      orderBy: { scheduled_at: 'desc' },
      select: planSelect,
    });
  }
}
