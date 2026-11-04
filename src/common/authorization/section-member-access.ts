import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthorizationResourceMetadata } from '../decorators/authorization-resource.decorator';
import type { PermissionRequirement } from '../decorators/permissions.decorator';
import type { SensitiveUserSubresourceMetadata } from '../decorators/sensitive-user-subresource.decorator';
import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import { getSensitiveUserSubresourcePolicy } from '../guards/sensitive-user-subresource-policy';
import {
  CLUB_ASSIGNMENT_LOCAL_FIELD_SELECT,
  CLUB_ASSIGNMENT_TEMPORAL_FIELDS,
} from './club-assignment-temporal';
import type { MemberTerritoryScopeService } from './member-territory-scope.service';
import { getActiveClubPermissions } from './permission-requirements';
import { getRequestValue, UUID_PARAM_PATTERN } from './policies/request-values';
import type { AssignmentEffectivity } from './policies/scope/instance-scope';
import { isTargetUserInActorScope } from './target-user-scope';

const SECTION_MEMBER_PROFILE_GATE_PERMISSIONS = new Set([
  'club_roles:read',
  'club_members:approve',
  'users:read_detail',
]);

/**
 * Club-scoped reads of a member of the actor's active section, each with the
 * club permissions that open it. Investiture eligibility
 * (`validation:read`) is for the section board only, the roles that present
 * investiture requests (decision 2026-11-02): `club_members:approve` is held
 * by director, deputy-director, secretary and secretary-treasurer.
 */
const SECTION_MEMBER_READ_GATES: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map<string, ReadonlySet<string>>([
  ['users:read_detail', SECTION_MEMBER_PROFILE_GATE_PERMISSIONS],
  ['classes:read', SECTION_MEMBER_PROFILE_GATE_PERMISSIONS],
  ['user_honors:read', SECTION_MEMBER_PROFILE_GATE_PERMISSIONS],
  ['validation:read', new Set(['club_members:approve'])],
]);

export class SectionMemberAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly effectivity: AssignmentEffectivity,
    private readonly memberScope?: MemberTerritoryScopeService,
  ) {}

  async isTargetUserInScope(
    request: any,
    actorUserId: string,
    resolved: ResolvedAuthorizationProfile,
    resource: AuthorizationResourceMetadata,
  ): Promise<boolean> {
    const targetUserId = getRequestValue(
      request,
      'param',
      resource.ownerParam ?? 'userId',
    );
    if (
      typeof targetUserId !== 'string' ||
      !UUID_PARAM_PATTERN.test(targetUserId)
    ) {
      return false;
    }
    return isTargetUserInActorScope(
      { prisma: this.prisma, memberScope: this.memberScope },
      actorUserId,
      resolved,
      targetUserId,
    );
  }

  async canReadSectionMemberProfile(
    request: any,
    actorUserId: string,
    resolved: ResolvedAuthorizationProfile,
    requirement: PermissionRequirement,
    resource: AuthorizationResourceMetadata,
    sensitiveUserSubresource?: SensitiveUserSubresourceMetadata,
  ): Promise<boolean> {
    if (resource.type !== 'user' || sensitiveUserSubresource) {
      return false;
    }

    if (
      requirement.permissions.length === 0 ||
      !requirement.permissions.every((permission) =>
        SECTION_MEMBER_READ_GATES.has(permission),
      )
    ) {
      return false;
    }

    const activeClubPermissions = getActiveClubPermissions(resolved);
    const canReadSectionMemberProfile = requirement.permissions.every(
      (permission) =>
        [...(SECTION_MEMBER_READ_GATES.get(permission) ?? [])].some((gate) =>
          activeClubPermissions.has(gate),
        ),
    );
    if (!canReadSectionMemberProfile) {
      return false;
    }

    return this.isTargetInActiveSection(
      request,
      actorUserId,
      resolved,
      resource,
      ['active', 'pending'],
    );
  }

  /**
   * Club-scoped read of a section member's sensitive subresources
   * (health, emergency contacts, ...). Requires the fine `<family>:read`
   * permission on the active club assignment — the legacy
   * `users:read_detail` fallback is intentionally not honored here — and
   * the target must be an active (not pending) member of the actor's
   * active section.
   */
  async canReadSectionMemberSensitiveSubresource(
    request: any,
    actorUserId: string,
    resolved: ResolvedAuthorizationProfile,
    resource: AuthorizationResourceMetadata,
    sensitiveUserSubresource?: SensitiveUserSubresourceMetadata,
  ): Promise<boolean> {
    if (
      resource.type !== 'user' ||
      !sensitiveUserSubresource ||
      sensitiveUserSubresource.mode !== 'read'
    ) {
      return false;
    }

    const finePermission = getSensitiveUserSubresourcePolicy(
      sensitiveUserSubresource.family,
      sensitiveUserSubresource.mode,
    ).finePermission;
    if (!getActiveClubPermissions(resolved).has(finePermission)) {
      return false;
    }

    return this.isTargetInActiveSection(
      request,
      actorUserId,
      resolved,
      resource,
      ['active'],
    );
  }

  async isTargetInActiveSection(
    request: any,
    actorUserId: string,
    resolved: ResolvedAuthorizationProfile,
    resource: AuthorizationResourceMetadata,
    allowedStatuses: string[],
  ): Promise<boolean> {
    const activeClubScope = resolved.authorization.effective.scope.club;
    const activeSectionId = activeClubScope?.section.club_section_id;
    if (typeof activeSectionId !== 'number') {
      return false;
    }

    const targetUserId = getRequestValue(
      request,
      'param',
      resource.ownerParam ?? 'userId',
    );

    if (
      typeof targetUserId !== 'string' ||
      !UUID_PARAM_PATTERN.test(targetUserId) ||
      targetUserId === actorUserId
    ) {
      return false;
    }

    const sectionAssignments = await this.prisma.club_role_assignments.findMany(
      {
        where: {
          user_id: targetUserId,
          club_section_id: activeSectionId,
          active: true,
          OR: [
            { status: null },
            {
              status: {
                in: allowedStatuses,
              },
            },
          ],
        },
        select: {
          assignment_id: true,
          active: true,
          status: true,
          ...CLUB_ASSIGNMENT_TEMPORAL_FIELDS,
          ...CLUB_ASSIGNMENT_LOCAL_FIELD_SELECT,
        },
      },
    );

    // Filas 'active' deben estar vigentes (policy). Las no activas (p. ej.
    // 'pending' en lecturas de flujo de alta) no otorgan autoridad y no
    // tienen vigencia que evaluar.
    return sectionAssignments.some(
      (assignment) =>
        assignment.status !== 'active' ||
        this.effectivity.isAssignmentEffective(assignment),
    );
  }
}
