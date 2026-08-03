import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcclesiasticalCycleDestinationPreflightService } from './ecclesiastical-cycle-destination-preflight.service';
import type { EcclesiasticalCycleAccessDto } from './ports/ecclesiastical-cycle-dependencies.port';

const LEASE_DURATION_MS = 5 * 60 * 1000;
type Db = Prisma.TransactionClient;
type PlanCase =
  | {
      state: 'ready' | 'pending_choice';
      userId: string;
      sourceEnrollmentId: number;
      sourceAssignmentId: string;
      targetClassId: number;
      canonicalTransitionId: number | null;
      targetClubSectionId?: number;
      reasons: string[];
    }
  | {
      state: 'blocked';
      userId: string;
      sourceEnrollmentId: number;
      sourceAssignmentId?: string;
      reasons: string[];
    };

@Injectable()
export class EcclesiasticalCycleRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preflight: EcclesiasticalCycleDestinationPreflightService,
  ) {}

  async plan(input: EcclesiasticalCycleAccessDto) {
    const preflight = await this.preflight.execute(input);
    return this.prisma.$transaction((tx) =>
      this.persist(tx as Db, input, preflight),
    );
  }

  private async persist(
    db: Db,
    input: EcclesiasticalCycleAccessDto,
    preflight: Awaited<
      ReturnType<EcclesiasticalCycleDestinationPreflightService['execute']>
    >,
  ) {
    await db.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ecclesiastical-cycle:${input.localFieldId}:${input.targetYearId}`}, 0))`,
    );
    const now = (
      await db.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT now() AS now`)
    )[0].now;
    const existing = await db.ecclesiastical_cycle_runs.findUnique({
      where: {
        local_field_id_target_year_id: {
          local_field_id: input.localFieldId,
          target_year_id: input.targetYearId,
        },
      },
    });
    if (existing?.status === 'completed')
      return { disposition: 'replayed' as const, runId: existing.run_id };
    if (
      existing?.status === 'running' &&
      existing.lease_expires_at &&
      existing.lease_expires_at > now
    ) {
      return { disposition: 'leased' as const, runId: existing.run_id };
    }

    const lease = {
      lease_token: randomUUID(),
      lease_expires_at: new Date(now.getTime() + LEASE_DURATION_MS),
    };
    const data = {
      status: 'running',
      owner_user_id: input.actorUserId,
      ...lease,
      capabilities_snapshot: preflight.capabilities as Prisma.InputJsonValue,
      summary: preflight.summary as Prisma.InputJsonValue,
      started_at: existing?.started_at ?? now,
    };
    const run = existing
      ? await db.ecclesiastical_cycle_runs.update({
          where: { run_id: existing.run_id },
          data,
        })
      : await db.ecclesiastical_cycle_runs.create({
          data: {
            ...data,
            local_field_id: input.localFieldId,
            target_year_id: input.targetYearId,
          },
        });
    const decisions = (preflight.cases as PlanCase[]).filter(
      (item): item is Extract<PlanCase, { sourceAssignmentId: string }> =>
        'sourceAssignmentId' in item && Boolean(item.sourceAssignmentId),
    );
    const eventData: Array<{
      run_id: string;
      decision_id?: string;
      event_key: string;
      event_type: string;
      actor_user_id: string;
      payload: Prisma.InputJsonValue;
    }> = [
      {
        run_id: run.run_id,
        event_key: `run.${run.run_id}.started`,
        event_type: 'RUN_STARTED',
        actor_user_id: input.actorUserId,
        payload: { summary: preflight.summary },
      },
    ];
    for (const item of decisions) {
      const status = item.state === 'ready' ? 'planned' : item.state;
      const reason = item.reasons.join('|') || null;
      const decision = await db.ecclesiastical_cycle_decisions.upsert({
        where: {
          user_id_source_assignment_id_target_year_id: {
            user_id: item.userId,
            source_assignment_id: item.sourceAssignmentId,
            target_year_id: input.targetYearId,
          },
        },
        create: {
          run_id: run.run_id,
          user_id: item.userId,
          source_assignment_id: item.sourceAssignmentId,
          source_enrollment_id: item.sourceEnrollmentId,
          target_year_id: input.targetYearId,
          canonical_transition_id:
            'canonicalTransitionId' in item ? item.canonicalTransitionId : null,
          target_class_id: 'targetClassId' in item ? item.targetClassId : null,
          target_club_section_id:
            'targetClubSectionId' in item
              ? (item.targetClubSectionId ?? null)
              : null,
          status,
          reason_code: reason,
          actor_user_id: input.actorUserId,
          effect_refs: [],
        },
        update: {},
      });
      eventData.push({
        run_id: run.run_id,
        decision_id: decision.decision_id,
        event_key: `decision.${decision.decision_id}.planned`,
        event_type: 'DECISION_PLANNED',
        actor_user_id: input.actorUserId,
        payload: { status, reason },
      });
    }
    eventData.push({
      run_id: run.run_id,
      event_key: `run.${run.run_id}.completed`,
      event_type: 'RUN_COMPLETED',
      actor_user_id: input.actorUserId,
      payload: { summary: preflight.summary },
    });
    await db.ecclesiastical_cycle_events.createMany({
      data: eventData,
      skipDuplicates: true,
    });
    await db.ecclesiastical_cycle_runs.update({
      where: { run_id: run.run_id },
      data: {
        status: 'completed',
        lease_token: null,
        lease_expires_at: null,
        completed_at: now,
        summary: preflight.summary,
      },
    });
    return {
      disposition: 'planned' as const,
      runId: run.run_id,
      decisions: decisions.length,
      skipped: preflight.cases.length - decisions.length,
    };
  }
}
