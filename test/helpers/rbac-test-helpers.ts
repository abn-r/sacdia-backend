import { JwtService } from '@nestjs/jwt';
import type {
  AuthorizationInstanceType,
  AuthorizationSnapshot,
} from '../../src/common/services/authorization-context.service';

type AuthorizationFixtureOptions = {
  globalPermissions?: string[];
  globalRoleName?: string;
  activePermissions?: string[];
  activeRoleName?: string;
  assignmentId?: string | null;
  clubId?: number;
  clubName?: string;
  instanceType?: AuthorizationInstanceType;
  instanceId?: number;
  instanceName?: string;
  localFieldId?: number;
  localFieldName?: string;
  unionId?: number;
  unionName?: string;
  countryId?: number;
  countryName?: string;
};

export function ensureTestJwtSecret() {
  process.env.SUPABASE_JWT_SECRET =
    process.env.SUPABASE_JWT_SECRET || 'test-secret';
}

export function createTestJwtService() {
  ensureTestJwtSecret();
  return new JwtService({
    secret: process.env.SUPABASE_JWT_SECRET,
  });
}

export function createBearerToken(
  jwtService: JwtService,
  sub: string,
  email = `${sub}@test.local`,
) {
  return jwtService.sign({ sub, email });
}

export function buildAuthorizationSnapshot(
  options: AuthorizationFixtureOptions = {},
): AuthorizationSnapshot {
  const globalPermissions = options.globalPermissions ?? [];
  const activePermissions = options.activePermissions ?? [];
  const assignmentId =
    options.assignmentId === undefined
      ? activePermissions.length > 0
        ? 'assignment-1'
        : null
      : options.assignmentId;

  const globalScope = {
    country:
      typeof options.countryId === 'number'
        ? { id: options.countryId, name: options.countryName ?? 'Country Test' }
        : undefined,
    union:
      typeof options.unionId === 'number'
        ? { id: options.unionId, name: options.unionName ?? 'Union Test' }
        : undefined,
    local_field:
      typeof options.localFieldId === 'number'
        ? {
            id: options.localFieldId,
            name: options.localFieldName ?? 'Local Field Test',
          }
        : undefined,
  };

  const clubAssignment =
    assignmentId === null
      ? null
      : {
          assignment_id: assignmentId,
          role_name: options.activeRoleName ?? 'director',
          permissions: activePermissions,
          club: {
            club_id: options.clubId ?? 1,
            club_name: options.clubName ?? 'Club Test',
          },
          instance: {
            type: options.instanceType ?? 'pathfinders',
            instance_id: options.instanceId ?? 1,
            instance_name: options.instanceName ?? 'Instance Test',
          },
          scope: globalScope,
          status: 'active',
          start_date: null,
          end_date: null,
        };

  return {
    grants: {
      global_roles:
        globalPermissions.length > 0 || options.globalRoleName
          ? [
              {
                role_name: options.globalRoleName ?? 'admin',
                permissions: globalPermissions,
                scope: globalScope,
              },
            ]
          : [],
      club_assignments: clubAssignment ? [clubAssignment] : [],
    },
    active_assignment: {
      assignment_id: assignmentId,
    },
    effective: {
      permissions: [...new Set([...globalPermissions, ...activePermissions])],
      scope: {
        global: globalScope,
        club: clubAssignment
          ? {
              assignment_id: clubAssignment.assignment_id,
              role_name: clubAssignment.role_name,
              club: clubAssignment.club,
              instance: clubAssignment.instance,
            }
          : null,
      },
    },
  };
}
