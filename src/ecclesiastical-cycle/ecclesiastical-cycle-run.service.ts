import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { EcclesiasticalCycleDestinationPreflightService } from './ecclesiastical-cycle-destination-preflight.service';
import type { EcclesiasticalCycleAccessDto } from './ports/ecclesiastical-cycle-dependencies.port';

const LEASE_MS = 5 * 60 * 1000;
// prettier-ignore
const keys = ['run_id','user_id','source_assignment_id','source_enrollment_id','target_year_id','canonical_transition_id','target_class_id','target_club_section_id','status','reason_code','actor_user_id','effect_refs'];
// prettier-ignore
const normalize = (value: any): any => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)])) : value;
const stable = (value: any) => JSON.stringify(normalize(value));
const digest = (value: any) =>
  createHash('sha256').update(stable(value)).digest('hex');
const conflict = (): never => {
  throw new AppConflictException(ErrorCode.IDEMPOTENCY_KEY_REUSED);
};
const same = (left: any, right: any) => {
  if (stable(left) !== stable(right)) conflict();
};
const payload = (value: any) =>
  value && Object.fromEntries(keys.map((key) => [key, value[key]]));
// prettier-ignore
const snapshot = (input: EcclesiasticalCycleAccessDto, preflight: any) => ({ request: input, preflight: { capabilities: preflight.capabilities, reasons: preflight.reasons, summary: preflight.summary, cases: preflight.cases } });
// prettier-ignore
const decisions = (runId: string, input: EcclesiasticalCycleAccessDto, cases: any[]) => cases.filter((item) => item.sourceAssignmentId).sort((left, right) => left.sourceAssignmentId.localeCompare(right.sourceAssignmentId)).map((item) => ({ run_id: runId, user_id: item.userId, source_assignment_id: item.sourceAssignmentId, source_enrollment_id: item.sourceEnrollmentId, target_year_id: input.targetYearId, canonical_transition_id: item.canonicalTransitionId ?? null, target_class_id: item.targetClassId ?? null, target_club_section_id: item.targetClubSectionId ?? null, status: item.state === 'ready' ? 'planned' : item.state, reason_code: item.reasons.join('|') || null, actor_user_id: input.actorUserId, effect_refs: [] }));
// prettier-ignore
const events = (runId: string, actor: string, state: any, rows: any[]) => [{ run_id: runId, decision_id: null, event_key: `run.${runId}.started`, event_type: 'RUN_STARTED', actor_user_id: actor, payload: { snapshot: state } }, ...rows.map((row) => ({ run_id: runId, decision_id: row.decision_id, event_key: `decision.${row.decision_id}.planned`, event_type: 'DECISION_PLANNED', actor_user_id: actor, payload: { hash: digest(payload(row)) } })), { run_id: runId, decision_id: null, event_key: `run.${runId}.completed`, event_type: 'RUN_COMPLETED', actor_user_id: actor, payload: { snapshot: state } }];

@Injectable()
export class EcclesiasticalCycleRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preflight: EcclesiasticalCycleDestinationPreflightService,
  ) {}

  async plan(input: EcclesiasticalCycleAccessDto) {
    return this.prisma.$transaction((tx) => this.persist(tx as any, input), {
      maxWait: 5_000,
      timeout: 20_000,
    });
  }

  private async persist(db: any, input: EcclesiasticalCycleAccessDto) {
    await db.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ecclesiastical-cycle:${input.localFieldId}:${input.targetYearId}`}, 0))`,
    );
    const now = (await db.$queryRaw(Prisma.sql`SELECT now() AS now`))[0]
      .now as Date;
    const existing = await db.ecclesiastical_cycle_runs.findUnique({
      where: {
        local_field_id_target_year_id: {
          local_field_id: input.localFieldId,
          target_year_id: input.targetYearId,
        },
      },
    });
    if (existing?.status === 'running' && existing.lease_expires_at > now) {
      await this.preflight.execute(input);
      return { disposition: 'leased' as const, runId: existing.run_id };
    }
    if (existing?.status === 'completed') {
      const preflight = await this.preflight.execute(input),
        state = snapshot(input, preflight);
      same(existing.summary, state);
      await this.replay(db, existing.run_id, input, preflight, state);
      return { disposition: 'replayed' as const, runId: existing.run_id };
    }
    const lease = {
      lease_token: randomUUID(),
      lease_expires_at: new Date(now.getTime() + LEASE_MS),
    };
    const run = existing
      ? await db.ecclesiastical_cycle_runs.update({
          where: { run_id: existing.run_id },
          data: {
            status: 'running',
            owner_user_id: input.actorUserId,
            ...lease,
          },
        })
      : await db.ecclesiastical_cycle_runs.create({
          data: {
            local_field_id: input.localFieldId,
            target_year_id: input.targetYearId,
            owner_user_id: input.actorUserId,
            status: 'running',
            capabilities_snapshot: {},
            started_at: now,
            ...lease,
          },
        });
    const preflight = await this.preflight.execute(input),
      state = snapshot(input, preflight);
    if (existing?.summary) same(existing.summary, state);
    if (preflight.reasons.length)
      return this.block(db, run.run_id, input, preflight, state);
    await db.ecclesiastical_cycle_runs.update({
      where: { run_id: run.run_id },
      data: { capabilities_snapshot: preflight.capabilities, summary: state },
    });
    const wanted = decisions(run.run_id, input, preflight.cases),
      rows = await this.persistDecisions(db, wanted);
    await this.persistEvents(
      db,
      events(run.run_id, input.actorUserId, state, rows),
    );
    await db.ecclesiastical_cycle_runs.update({
      where: { run_id: run.run_id },
      data: {
        status: 'completed',
        lease_token: null,
        lease_expires_at: null,
        completed_at: now,
        summary: state,
      },
    });
    return {
      disposition: 'planned' as const,
      runId: run.run_id,
      decisions: wanted.length,
      skipped: preflight.cases.length - wanted.length,
    };
  }

  private async persistDecisions(db: any, wanted: any[]) {
    if (!wanted.length) return [];
    const current = await db.ecclesiastical_cycle_decisions.findMany({
      where: {
        target_year_id: wanted[0].target_year_id,
        source_assignment_id: {
          in: wanted.map((item) => item.source_assignment_id),
        },
      },
      orderBy: { source_assignment_id: 'asc' },
    });
    if (current.length) {
      if (current.length !== wanted.length) conflict();
      wanted.forEach((item) =>
        same(
          payload(
            current.find(
              (row: any) =>
                row.source_assignment_id === item.source_assignment_id,
            ),
          ),
          payload(item),
        ),
      );
      return current;
    }
    await db.ecclesiastical_cycle_decisions.createMany({ data: wanted });
    const rows = await db.ecclesiastical_cycle_decisions.findMany({
      where: { run_id: wanted[0].run_id },
      orderBy: { source_assignment_id: 'asc' },
    });
    if (rows.length !== wanted.length) conflict();
    return rows;
  }

  private async persistEvents(db: any, wanted: any[]) {
    const current = await db.ecclesiastical_cycle_events.findMany({
      where: { event_key: { in: wanted.map((event) => event.event_key) } },
      orderBy: { event_key: 'asc' },
    });
    if (!current.length)
      return db.ecclesiastical_cycle_events.createMany({ data: wanted });
    if (current.length !== wanted.length) conflict();
    wanted.forEach((event) => {
      const row = current.find(
        (item: any) => item.event_key === event.event_key,
      );
      same(
        row && {
          run_id: row.run_id,
          decision_id: row.decision_id,
          event_key: row.event_key,
          event_type: row.event_type,
          actor_user_id: row.actor_user_id,
          payload: row.payload,
        },
        event,
      );
    });
  }

  private async replay(
    db: any,
    runId: string,
    input: EcclesiasticalCycleAccessDto,
    preflight: any,
    state: any,
  ) {
    const rows = await this.persistDecisions(
      db,
      decisions(runId, input, preflight.cases),
    );
    await this.persistEvents(db, events(runId, input.actorUserId, state, rows));
  }

  private async block(
    db: any,
    runId: string,
    input: EcclesiasticalCycleAccessDto,
    preflight: any,
    state: any,
  ) {
    const event = {
      run_id: runId,
      decision_id: null,
      event_key: `run.${runId}.blocked.${digest(state).slice(0, 16)}`,
      event_type: 'RUN_BLOCKED',
      actor_user_id: input.actorUserId,
      payload: { snapshot: state },
    };
    await db.ecclesiastical_cycle_runs.update({
      where: { run_id: runId },
      data: {
        status: 'blocked',
        lease_token: null,
        lease_expires_at: null,
        completed_at: null,
        summary: state,
        capabilities_snapshot: preflight.capabilities,
      },
    });
    await this.persistEvents(db, [event]);
    return {
      disposition: 'blocked' as const,
      runId,
      retryable: true,
      reasons: preflight.reasons,
    };
  }
}
