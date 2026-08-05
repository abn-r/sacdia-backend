import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { CriticalAuditWriterService } from '../audit-logs/critical-audit-writer.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { ExactSuperAdminWritePolicy } from './exact-super-admin-write.policy';
type Mutation = 'assign' | 'revoke';
type Database = Pick<PrismaService, '$transaction'>;
type Tx = Pick<
  Prisma.TransactionClient,
  '$queryRaw' | 'users' | 'roles' | 'users_roles' | 'audit_logs'
>;
type Existing = { user_role_id: string; active: boolean } | null;
export type GlobalUserRoleWriteInput = {
  actorUserId: string;
  targetUserId: string;
  roleId: string;
  correlationId: string;
  idempotencyKey: string;
};
export type GlobalUserRoleWriteResult = {
  active: boolean;
  changed: boolean;
  replayed: boolean;
};
@Injectable()
export class GlobalUserRoleWriteService {
  constructor(
    private readonly prisma: Database,
    private readonly exactSuperAdmin: ExactSuperAdminWritePolicy,
    private readonly audit: CriticalAuditWriterService,
  ) {}
  assign(input: GlobalUserRoleWriteInput) {
    return this.write('assign', input);
  }
  revoke(input: GlobalUserRoleWriteInput) {
    return this.write('revoke', input);
  }
  private async write(mutation: Mutation, raw: GlobalUserRoleWriteInput) {
    const input = {
      actorUserId: raw.actorUserId.toLowerCase(),
      targetUserId: raw.targetUserId.toLowerCase(),
      roleId: raw.roleId.toLowerCase(),
      correlationId: raw.correlationId.toLowerCase(),
      idempotencyKey: raw.idempotencyKey,
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.inTransaction(tx, mutation, input),
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
      } catch (error) {
        if (!this.isRetryable(error)) throw error;
        if (attempt === 2)
          throw new AppConflictException(ErrorCode.RECORD_CONFLICT);
      }
    }
    throw new AppConflictException(ErrorCode.RECORD_CONFLICT);
  }
  private async inTransaction(
    tx: Tx,
    mutation: Mutation,
    input: GlobalUserRoleWriteInput,
  ): Promise<GlobalUserRoleWriteResult> {
    for (const userId of [
      ...new Set([input.actorUserId, input.targetUserId]),
    ].sort())
      await this.lock(tx, `rbac-user:${userId}`);
    await this.exactSuperAdmin.assert(input.actorUserId, tx);
    const eventKey = `rbac-global-users-role:${input.idempotencyKey}`;
    const requestHash = this.digest(
      `${mutation}:${input.actorUserId}:${input.targetUserId}:${input.roleId}`,
    );
    const entityId = this.digest(`${input.targetUserId}:${input.roleId}`);
    await this.lock(tx, `critical-audit:${eventKey}`);
    const replay = await tx.audit_logs.findUnique({
      where: { event_key: eventKey },
      select: {
        entity_type: true,
        entity_id: true,
        action: true,
        actor_user_id: true,
        actor_scope: true,
        target_user_id: true,
        target_scope: true,
        changes: true,
        result: true,
        idempotency_key: true,
      },
    });
    if (replay)
      return this.replay(replay, mutation, input, entityId, requestHash);
    const [target, role] = await Promise.all([
      tx.users.findUnique({
        where: { user_id: input.targetUserId },
        select: { user_id: true },
      }),
      tx.roles.findUnique({
        where: { role_id: input.roleId },
        select: {
          role_name: true,
          role_category: true,
          active: true,
        },
      }),
    ]);
    if (!target)
      throw new AppNotFoundException(ErrorCode.RBAC_USER_NOT_FOUND, {
        id: input.targetUserId,
      });
    if (!role)
      throw new AppNotFoundException(ErrorCode.RBAC_ROLE_NOT_FOUND, {
        id: input.roleId,
      });
    if (role.role_category !== 'GLOBAL' || !role.active)
      throw new AppBadRequestException(ErrorCode.RBAC_GLOBAL_ROLE_REQUIRED);
    const existing = await tx.users_roles.findFirst({
      where: { user_id: input.targetUserId, role_id: input.roleId },
      select: { user_role_id: true, active: true },
    });
    const state = this.state(mutation, existing);
    if (state.changed && existing)
      await tx.users_roles.update({
        where: { user_role_id: existing.user_role_id },
        data: { active: state.active, modified_at: new Date() },
      });
    else if (state.changed)
      await tx.users_roles.create({
        data: { user_id: input.targetUserId, role_id: input.roleId },
      });
    await this.audit.write(tx, {
      entityType: 'users_roles',
      entityId,
      action: state.action,
      eventKey,
      actor: {
        kind: 'user',
        userId: input.actorUserId,
        roleName: 'super-admin',
        scope: { role_category: 'GLOBAL' },
      },
      target: {
        userId: input.targetUserId,
        scope: { role_id: input.roleId, request_hash: requestHash },
      },
      before: { active: state.before },
      after: { active: state.active },
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      result: 'succeeded',
    });
    return { active: state.active, changed: state.changed, replayed: false };
  }
  private replay(
    event: Record<string, unknown>,
    mutation: Mutation,
    input: GlobalUserRoleWriteInput,
    entityId: string,
    requestHash: string,
  ): GlobalUserRoleWriteResult {
    const changedAction =
      mutation === 'assign'
        ? 'RBAC_GLOBAL_ROLE_ASSIGNED'
        : 'RBAC_GLOBAL_ROLE_REVOKED';
    const noopAction =
      mutation === 'assign'
        ? 'RBAC_GLOBAL_ROLE_ASSIGNMENT_NOOP'
        : 'RBAC_GLOBAL_ROLE_REVOCATION_NOOP';
    const changed = event.action === changedAction;
    const active = mutation === 'assign';
    const expectedChanges = {
      before: { active: changed ? !active : active },
      after: { active },
    };
    if (
      (event.action !== changedAction && event.action !== noopAction) ||
      event.entity_type !== 'users_roles' ||
      event.entity_id !== entityId ||
      event.actor_user_id !== input.actorUserId ||
      event.target_user_id !== input.targetUserId ||
      event.idempotency_key !== input.idempotencyKey ||
      event.result !== 'succeeded' ||
      this.stable(event.actor_scope) !==
        this.stable({ role_category: 'GLOBAL' }) ||
      this.stable(event.target_scope) !==
        this.stable({ role_id: input.roleId, request_hash: requestHash }) ||
      this.stable(event.changes) !== this.stable(expectedChanges)
    )
      throw new AppConflictException(ErrorCode.IDEMPOTENCY_KEY_REUSED);
    return { active, changed, replayed: true };
  }
  private state(mutation: Mutation, existing: Existing) {
    const active = mutation === 'assign';
    const before = existing?.active ?? false;
    const changed = active ? !before : before;
    const action = changed
      ? `RBAC_GLOBAL_ROLE_${active ? 'ASSIGNED' : 'REVOKED'}`
      : `RBAC_GLOBAL_ROLE_${active ? 'ASSIGNMENT' : 'REVOCATION'}_NOOP`;
    return { active, changed, action, before };
  }
  private digest(value: unknown): string {
    return createHash('sha256').update(this.stable(value)).digest('hex');
  }
  private stable(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((item) => this.stable(item)).join(',')}]`;
    if (value !== null && typeof value === 'object')
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${this.stable((value as Record<string, unknown>)[key])}`,
        )
        .join(',')}}`;
    return JSON.stringify(value) ?? 'undefined';
  }
  private isRetryable(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'P2002' || error.code === 'P2034')
    );
  }
  private lock(tx: Tx, key: string): Promise<unknown> {
    return tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  }
}
