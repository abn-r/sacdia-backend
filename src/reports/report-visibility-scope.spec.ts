import { ErrorCode } from '../common/errors/error-codes';
import {
  buildReportClubWhere,
  resolveReportVisibilityScope,
} from './report-visibility-scope';

const resolvedAuth = ({
  globalRoles = [],
  divisionId,
  unionId,
  localFieldId,
  activeAssignmentRole,
  activeClubSectionId = 55,
}: {
  globalRoles?: string[];
  divisionId?: number;
  unionId?: number;
  localFieldId?: number;
  activeAssignmentRole?: string;
  activeClubSectionId?: number;
}) => {
  const assignmentId = activeAssignmentRole ? 'active-assignment' : null;

  return {
    authorization: {
      grants: {
        global_roles: globalRoles.map((role_name) => ({
          role_name,
          permissions: ['reports:read'],
          scope: {},
        })),
        club_assignments: activeAssignmentRole
          ? [
              {
                assignment_id: assignmentId,
                role_name: activeAssignmentRole,
                permissions: ['reports:read'],
                section: { club_section_id: activeClubSectionId },
              },
            ]
          : [],
      },
      active_assignment: { assignment_id: assignmentId },
      effective: {
        scope: {
          global: {
            ...(divisionId === undefined
              ? {}
              : { division: { id: divisionId, name: 'DIA' } }),
            ...(unionId === undefined
              ? {}
              : { union: { id: unionId, name: 'Unión' } }),
            ...(localFieldId === undefined
              ? {}
              : { local_field: { id: localFieldId, name: 'Campo' } }),
          },
        },
      },
    },
  } as any;
};

describe('report visibility scope', () => {
  it('lets administrators apply explicit division, union and local-field filters', () => {
    const scope = resolveReportVisibilityScope(
      resolvedAuth({ globalRoles: ['admin'] }),
      { divisionId: 1, unionId: 2, localFieldId: 3 },
    );

    expect(scope).toEqual({
      access: 'all',
      divisionId: 1,
      unionId: 2,
      localFieldId: 3,
    });
    expect(buildReportClubWhere(scope)).toEqual({
      local_field_id: 3,
      local_fields: {
        union_id: 2,
        unions: { division_id: 1 },
      },
    });
  });

  it('forces union-tier actors to their own union while allowing narrower local-field filters', () => {
    const scope = resolveReportVisibilityScope(
      resolvedAuth({ globalRoles: ['director-union'], unionId: 20 }),
      { unionId: 99, localFieldId: 7 },
    );

    expect(scope).toEqual({
      access: 'union',
      unionId: 20,
      localFieldId: 7,
    });
    expect(buildReportClubWhere(scope)).toEqual({
      local_field_id: 7,
      local_fields: { union_id: 20 },
    });
  });

  it('forces field-tier actors to their own local field', () => {
    const scope = resolveReportVisibilityScope(
      resolvedAuth({ globalRoles: ['director-lf'], localFieldId: 7 }),
      { localFieldId: 99 },
    );

    expect(scope).toEqual({
      access: 'local_field',
      localFieldId: 7,
    });
    expect(buildReportClubWhere(scope)).toEqual({
      local_field_id: 7,
    });
  });

  it('scopes coordinators to assigned club sections and ignores local-field filters', () => {
    const scope = resolveReportVisibilityScope(
      resolvedAuth({ globalRoles: ['coordinator'], localFieldId: 7 }),
      { localFieldId: 99 },
      [20, 21],
    );

    expect(scope).toEqual({
      access: 'club_sections',
      clubSectionIds: [20, 21],
    });
    expect(buildReportClubWhere(scope)).toEqual({
      club_sections: {
        some: { club_section_id: { in: [20, 21] } },
      },
    });
  });

  it('rejects coordinators without assigned club sections', () => {
    expect(() =>
      resolveReportVisibilityScope(
        resolvedAuth({ globalRoles: ['coordinator'], localFieldId: 7 }),
        {},
      ),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING }),
    );
  });

  it('falls back to the active club section for club-scoped report readers', () => {
    const scope = resolveReportVisibilityScope(
      resolvedAuth({
        activeAssignmentRole: 'secretary',
        activeClubSectionId: 44,
      }),
      { localFieldId: 99 },
    );

    expect(scope).toEqual({
      access: 'club_section',
      clubSectionId: 44,
    });
  });

  it('rejects scoped actors when their territory scope is missing', () => {
    expect(() =>
      resolveReportVisibilityScope(
        resolvedAuth({ globalRoles: ['director-union'] }),
        {},
      ),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING }),
    );
  });
});
