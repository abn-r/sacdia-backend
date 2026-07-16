import { Injectable } from '@nestjs/common';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../common/services/authorization-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  OperationsDashboardScopeFilters,
  OperationsDashboardScopeLevel,
  OperationsDashboardScopePathNode,
  ResolvedOperationsDashboardScope,
} from './operations-dashboard.types';

const GLOBAL_ROLES = new Set(['super-admin']);
const DIVISION_ROLES = new Set(['director-dia', 'assistant-dia']);
const UNION_ROLES = new Set(['director-union', 'assistant-union']);
const LOCAL_FIELD_ROLES = new Set(['director-lf', 'assistant-lf']);
const ADMIN_SCOPE_ROLES = new Set(['admin', 'assistant-admin']);

type ActorBaseScope = {
  level: OperationsDashboardScopeLevel;
  id: number | null;
};

@Injectable()
export class OperationsDashboardScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  async resolve(
    actorId: string,
    filters: OperationsDashboardScopeFilters,
  ): Promise<ResolvedOperationsDashboardScope> {
    const authorization =
      await this.authorizationContext.resolveUserAuthorization(actorId);
    const base = this.resolveActorBaseScope(authorization);

    this.assertSameLevelFiltersWithinBase(base, authorization, filters);

    const targetLevel = this.resolveTargetLevel(base.level, filters);
    if (targetLevel === 'all') {
      return { level: 'all', id: null, name: 'Todos', path: [] };
    }

    const targetId = this.resolveTargetId(targetLevel, base, filters);
    let target: ResolvedOperationsDashboardScope;
    try {
      target = await this.loadTarget(targetLevel, targetId);
    } catch (error) {
      if (base.level !== 'all' && error instanceof AppNotFoundException) {
        this.denyOutsideScope();
      }
      throw error;
    }

    this.assertTargetWithinActorBase(base, target.path);
    this.assertRequestedChainIsConsistent(filters, target.path);

    return target;
  }

  private resolveActorBaseScope(
    resolved: ResolvedAuthorizationProfile,
  ): ActorBaseScope {
    const roles = new Set(
      resolved.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );
    const globalScope = resolved.authorization.effective.scope.global;

    if (hasAnyRole(roles, GLOBAL_ROLES)) {
      return { level: 'all', id: null };
    }

    if (hasAnyRole(roles, DIVISION_ROLES)) {
      return {
        level: 'division',
        id: this.requireNumericScopeId(globalScope.division?.id),
      };
    }

    if (hasAnyRole(roles, UNION_ROLES)) {
      return {
        level: 'union',
        id: this.requireNumericScopeId(globalScope.union?.id),
      };
    }

    if (hasAnyRole(roles, LOCAL_FIELD_ROLES)) {
      return {
        level: 'local_field',
        id: this.requireNumericScopeId(globalScope.local_field?.id),
      };
    }

    if (hasAnyRole(roles, ADMIN_SCOPE_ROLES)) {
      if (typeof globalScope.union?.id === 'number') {
        return { level: 'union', id: globalScope.union.id };
      }
      if (typeof globalScope.local_field?.id === 'number') {
        return { level: 'local_field', id: globalScope.local_field.id };
      }
      if (typeof globalScope.division?.id === 'number') {
        return { level: 'division', id: globalScope.division.id };
      }
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }

    throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
  }

  private requireNumericScopeId(value: number | string | undefined): number {
    if (typeof value !== 'number') {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }
    return value;
  }

  private assertSameLevelFiltersWithinBase(
    base: ActorBaseScope,
    resolved: ResolvedAuthorizationProfile,
    filters: OperationsDashboardScopeFilters,
  ): void {
    if (base.level === 'all') return;

    const globalScope = resolved.authorization.effective.scope.global;
    const expectedDivisionId = globalScope.division?.id;
    const expectedUnionId = globalScope.union?.id;
    const expectedLocalFieldId = globalScope.local_field?.id;

    if (
      filters.divisionId !== undefined &&
      typeof expectedDivisionId === 'number' &&
      filters.divisionId !== expectedDivisionId
    ) {
      this.denyOutsideScope();
    }

    if (
      (base.level === 'union' || base.level === 'local_field') &&
      filters.unionId !== undefined &&
      typeof expectedUnionId === 'number' &&
      filters.unionId !== expectedUnionId
    ) {
      this.denyOutsideScope();
    }

    if (
      base.level === 'local_field' &&
      filters.localFieldId !== undefined &&
      typeof expectedLocalFieldId === 'number' &&
      filters.localFieldId !== expectedLocalFieldId
    ) {
      this.denyOutsideScope();
    }
  }

  private resolveTargetLevel(
    baseLevel: OperationsDashboardScopeLevel,
    filters: OperationsDashboardScopeFilters,
  ): OperationsDashboardScopeLevel {
    if (baseLevel === 'local_field') return 'local_field';
    if (filters.localFieldId !== undefined) return 'local_field';
    if (baseLevel === 'union') return 'union';
    if (filters.unionId !== undefined) return 'union';
    if (baseLevel === 'division') return 'division';
    if (filters.divisionId !== undefined) return 'division';
    return 'all';
  }

  private resolveTargetId(
    targetLevel: Exclude<OperationsDashboardScopeLevel, 'all'>,
    base: ActorBaseScope,
    filters: OperationsDashboardScopeFilters,
  ): number {
    const requested =
      targetLevel === 'local_field'
        ? filters.localFieldId
        : targetLevel === 'union'
          ? filters.unionId
          : filters.divisionId;

    if (requested !== undefined) return requested;
    if (base.level === targetLevel && typeof base.id === 'number') {
      return base.id;
    }

    throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
  }

  private async loadTarget(
    level: Exclude<OperationsDashboardScopeLevel, 'all'>,
    id: number,
  ): Promise<ResolvedOperationsDashboardScope> {
    if (level === 'division') {
      const record = await this.prisma.divisions.findUnique({
        where: { division_id: id },
        select: { division_id: true, name: true },
      });
      if (!record) {
        throw new AppNotFoundException(ErrorCode.ADMIN_DIVISION_NOT_FOUND);
      }
      const node = this.pathNode('division', record.division_id, record.name);
      return {
        level,
        id: record.division_id,
        name: record.name,
        path: [node],
      };
    }

    if (level === 'union') {
      const record = await this.prisma.unions.findUnique({
        where: { union_id: id },
        select: {
          union_id: true,
          name: true,
          divisions: { select: { division_id: true, name: true } },
        },
      });
      if (!record) {
        throw new AppNotFoundException(ErrorCode.ADMIN_UNION_NOT_FOUND);
      }
      const divisionNode = this.pathNode(
        'division',
        record.divisions.division_id,
        record.divisions.name,
      );
      const unionNode = this.pathNode('union', record.union_id, record.name);
      return {
        level,
        id: record.union_id,
        name: record.name,
        path: [divisionNode, unionNode],
      };
    }

    const record = await this.prisma.local_fields.findUnique({
      where: { local_field_id: id },
      select: {
        local_field_id: true,
        name: true,
        unions: {
          select: {
            union_id: true,
            name: true,
            divisions: { select: { division_id: true, name: true } },
          },
        },
      },
    });
    if (!record) {
      throw new AppNotFoundException(ErrorCode.ADMIN_LOCAL_FIELD_NOT_FOUND);
    }

    const divisionNode = this.pathNode(
      'division',
      record.unions.divisions.division_id,
      record.unions.divisions.name,
    );
    const unionNode = this.pathNode(
      'union',
      record.unions.union_id,
      record.unions.name,
    );
    const localFieldNode = this.pathNode(
      'local_field',
      record.local_field_id,
      record.name,
    );

    return {
      level,
      id: record.local_field_id,
      name: record.name,
      path: [divisionNode, unionNode, localFieldNode],
    };
  }

  private pathNode(
    level: OperationsDashboardScopePathNode['level'],
    id: number,
    name: string,
  ): OperationsDashboardScopePathNode {
    return { level, id, name };
  }

  private assertRequestedChainIsConsistent(
    filters: OperationsDashboardScopeFilters,
    path: OperationsDashboardScopePathNode[],
  ): void {
    const divisionId = path.find((node) => node.level === 'division')?.id;
    const unionId = path.find((node) => node.level === 'union')?.id;
    const localFieldId = path.find((node) => node.level === 'local_field')?.id;

    const inconsistent =
      (filters.divisionId !== undefined &&
        (filters.unionId !== undefined || filters.localFieldId !== undefined) &&
        filters.divisionId !== divisionId) ||
      (filters.unionId !== undefined &&
        filters.localFieldId !== undefined &&
        filters.unionId !== unionId) ||
      (filters.localFieldId !== undefined &&
        filters.localFieldId !== localFieldId);

    if (inconsistent) {
      throw new AppBadRequestException(ErrorCode.ANALYTICS_SCOPE_CHAIN_INVALID);
    }
  }

  private assertTargetWithinActorBase(
    base: ActorBaseScope,
    path: OperationsDashboardScopePathNode[],
  ): void {
    if (base.level === 'all') return;
    const targetNode = path.find((node) => node.level === base.level);
    if (!targetNode || targetNode.id !== base.id) {
      this.denyOutsideScope();
    }
  }

  private denyOutsideScope(): never {
    throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
  }
}

function hasAnyRole(roleNames: Set<string>, allowed: Set<string>): boolean {
  for (const roleName of allowed) {
    if (roleNames.has(roleName)) return true;
  }
  return false;
}
