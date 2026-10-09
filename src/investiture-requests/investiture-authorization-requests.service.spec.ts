import { Job } from 'bullmq';
import { AchievementsService } from '../achievements/achievements.service';
import { ErrorCode } from '../common/errors/error-codes';
import type {
  AuthorizationSnapshot,
  ClubAuthorizationGrant,
} from '../common/services/authorization-context.service';
import {
  INVESTITURE_SYSTEM_REJECTION_TEXT,
  InvestitureAuthorizationRequestService,
} from './investiture-authorization-requests.service';
import {
  crossTypeHomeAssignmentWhere,
  sectionMemberAssignmentWhere,
} from './investiture-presentation-context';
import { closePendingInvestitureAuthorizations } from './investiture-year-close';

const SECTION_ID = 4;
const YEAR_ID = 2026;
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INSIDE = new Date('2026-10-15T18:00:00.000Z');
const OUTSIDE = new Date('2026-02-15T18:00:00.000Z');
const DATE = '2026-11-01';
const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type EnrollmentSeed = {
  enrollment_id: number;
  user_id: string;
  class_id: number;
  ecclesiastical_year_id: number;
  investiture_status: string;
  locked_for_validation: boolean;
  record_kind: string;
  cross_type_enrollment: boolean;
  active: boolean;
  classes: {
    min_duration_years: number;
    max_duration_years: number;
    club_type_id: number;
    club_types: { name: string } | null;
    asset_code?: string | null;
  } | null;
  ecclesiastical_year: { start_date: Date } | null;
};

type PersonSeed = {
  person_id: string;
  request_id: string;
  user_id: string;
  class_id: number;
  enrollment_id: number;
  investiture_date: Date;
  status: string;
  single_slot: boolean;
  resolution_code: string | null;
  resolved_by_id: string | null;
  authorization_comment?: string | null;
  rejection_reason?: string | null;
  system_reason?: string | null;
  achievement_intent_key?: string | null;
};

type RequestSeed = {
  request_id: string;
  club_section_id: number;
  ecclesiastical_year_id: number;
  created_by_id: string;
  created_at?: Date;
};

const SEED_CREATED_AT = new Date('2026-10-01T12:00:00.000Z');

function director(
  role = 'director',
  sectionId = SECTION_ID,
): AuthorizationSnapshot {
  return snapshot([role], [], sectionId);
}

function snapshot(
  clubRoles: string[],
  globalRoles: string[],
  sectionId = SECTION_ID,
): AuthorizationSnapshot {
  const club_assignments: ClubAuthorizationGrant[] = clubRoles.map(
    (role, index) => ({
      assignment_id: `grant-${index}`,
      role_name: role,
      permissions: [],
      operational: true,
      ecclesiastical_year_id: YEAR_ID,
      club: { club_id: 1, club_name: 'Club' },
      section: { club_section_id: sectionId, club_type_id: 1 },
      scope: {},
      status: 'active',
    }),
  );
  return {
    grants: {
      global_roles: globalRoles.map((role_name) => ({
        role_name,
        permissions: [],
        scope: {},
      })),
      club_assignments,
      direct_permissions: [],
    },
    active_assignment: {
      assignment_id: club_assignments[0]?.assignment_id ?? null,
    },
    effective: { permissions: [], scope: { global: {}, club: null } },
  };
}

function createWorld(options?: {
  pauseOnPendingRead?: boolean;
  pauseOnRemove?: boolean;
  beforeFirstLock?: () => void;
}) {
  const enrollments: EnrollmentSeed[] = [];
  const requests: RequestSeed[] = [];
  const people: PersonSeed[] = [];
  const members: Array<{
    assignment_id: string;
    user_id: string;
    club_section_id: number;
    club_type_id: number;
    main_club_id: number;
    ecclesiastical_year_id: number;
    active: boolean;
    status: string;
  }> = [];
  const year = {
    year_id: YEAR_ID,
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    end_date: new Date('2026-12-31T00:00:00.000Z'),
    active: true,
  };
  const section = {
    club_section_id: SECTION_ID,
    club_type_id: 1,
    active: true,
    main_club_id: 1,
    club_types: { name: 'Conquistadores' },
    clubs: {
      club_id: 1,
      name: 'Club Norte',
      local_field_id: 10,
      local_fields: { timezone: 'America/Mexico_City' },
      churches: {
        districlub_type_id: 3,
        districts: { name: 'Distrito Sur' },
      },
    },
  };
  let windowRow: { start_date: Date; end_date: Date } | null = null;
  let yearCount = 1;
  const pastors: Array<{
    user_id: string;
    districlub_type_id: number;
    active: boolean;
  }> = [];
  const deletedAccounts = new Set<string>();
  const sections = [section];
  const userNames = new Map<string, string>();
  let seq = 1;
  const held = new Map<string, symbol>();
  const queues = new Map<string, Array<() => void>>();
  let didPause = false;
  let lockHookArmed = false;
  let lockHookUsed = false;
  let lockHook = options?.beforeFirstLock;
  let markEntered: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  let releasePause: () => void = () => undefined;
  const paused = new Promise<void>((resolve) => {
    releasePause = resolve;
  });

  const acquire = (token: symbol, key: string) => {
    if (held.get(key) === token) {
      return Promise.resolve();
    }
    if (!held.has(key)) {
      held.set(key, token);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const queue = queues.get(key) ?? [];
      queue.push(() => {
        held.set(key, token);
        resolve();
      });
      queues.set(key, queue);
    });
  };
  const release = (token: symbol) => {
    for (const [key, owner] of [...held.entries()]) {
      if (owner !== token) {
        continue;
      }
      held.delete(key);
      const next = queues.get(key)?.shift();
      if (next) {
        next();
      } else {
        queues.delete(key);
      }
    }
  };

  const matchesPerson = (
    row: PersonSeed,
    where: {
      person_id?: string | { in: string[] };
      user_id?: string | { in: string[] };
      class_id?: number;
      status?: string | { in: string[] };
      resolution_code?: string;
      system_reason?: string;
      request_id?: string;
      enrollment_id?: number | { in: number[] };
      request?: {
        request_id?: string;
        club_section_id?: number;
        ecclesiastical_year_id?: number;
      };
    } = {},
  ) => {
    if (
      typeof where.person_id === 'string' &&
      row.person_id !== where.person_id
    ) {
      return false;
    }
    if (
      where.person_id &&
      typeof where.person_id === 'object' &&
      !where.person_id.in.includes(row.person_id)
    ) {
      return false;
    }
    if (typeof where.user_id === 'string' && row.user_id !== where.user_id) {
      return false;
    }
    if (
      where.user_id &&
      typeof where.user_id === 'object' &&
      !where.user_id.in.includes(row.user_id)
    ) {
      return false;
    }
    if (where.class_id !== undefined && row.class_id !== where.class_id) {
      return false;
    }
    if (
      where.status &&
      typeof where.status === 'object' &&
      'in' in where.status
    ) {
      if (!where.status.in.includes(row.status)) {
        return false;
      }
    } else if (where.status && row.status !== where.status) {
      return false;
    }
    if (
      where.resolution_code &&
      row.resolution_code !== where.resolution_code
    ) {
      return false;
    }
    if (
      'system_reason' in where &&
      where.system_reason !== undefined &&
      row.system_reason !== where.system_reason
    ) {
      return false;
    }
    if (where.request_id && row.request_id !== where.request_id) {
      return false;
    }
    if (
      typeof where.enrollment_id === 'number' &&
      row.enrollment_id !== where.enrollment_id
    ) {
      return false;
    }
    if (
      where.enrollment_id &&
      typeof where.enrollment_id === 'object' &&
      !where.enrollment_id.in.includes(row.enrollment_id)
    ) {
      return false;
    }
    if (where.request) {
      const request = requests.find(
        (item) => item.request_id === row.request_id,
      );
      if (!request) {
        return false;
      }
      if (
        where.request.request_id &&
        request.request_id !== where.request.request_id
      ) {
        return false;
      }
      if (
        where.request.club_section_id !== undefined &&
        request.club_section_id !== where.request.club_section_id
      ) {
        return false;
      }
      if (
        where.request.ecclesiastical_year_id !== undefined &&
        request.ecclesiastical_year_id !== where.request.ecclesiastical_year_id
      ) {
        return false;
      }
    }
    return true;
  };

  const peopleDelegate = {
    findUnique: jest.fn(async ({ where }: { where: { person_id: string } }) => {
      return people.find((row) => row.person_id === where.person_id) ?? null;
    }),
    findFirst: jest.fn(
      async ({
        where,
        orderBy,
      }: {
        where?: object;
        orderBy?: Array<Record<string, 'asc' | 'desc'>>;
      }) => {
        const matched = people.filter((row) => matchesPerson(row, where ?? {}));
        if (orderBy?.length) {
          matched.sort((left, right) => {
            for (const key of orderBy) {
              const field = Object.keys(key)[0] as keyof PersonSeed;
              const direction = key[field] === 'desc' ? -1 : 1;
              const compared = String(left[field] ?? '').localeCompare(
                String(right[field] ?? ''),
              );
              if (compared !== 0) {
                return compared * direction;
              }
            }
            return 0;
          });
        }
        return matched[0] ?? null;
      },
    ),
    findMany: jest.fn(
      async ({
        where,
        select,
        include,
      }: {
        where?: object;
        select?: { request?: unknown };
        include?: { request?: unknown };
      }) => {
        const matched = people.filter((row) => matchesPerson(row, where ?? {}));
        const pendingRead =
          where &&
          typeof where === 'object' &&
          'user_id' in where &&
          'status' in where &&
          (where as { status?: string }).status === 'PENDING';
        if (options?.pauseOnPendingRead && pendingRead && !didPause) {
          didPause = true;
          markEntered();
          await paused;
        }
        if (!select?.request && !include?.request) {
          return matched;
        }
        return matched.map((row) => ({
          ...row,
          request:
            requests.find((item) => item.request_id === row.request_id) ?? null,
        }));
      },
    ),
    create: jest.fn(
      async ({
        data,
      }: {
        data: Omit<
          PersonSeed,
          'person_id' | 'resolution_code' | 'resolved_by_id'
        >;
      }) => {
        const row: PersonSeed = {
          person_id: `11111111-1111-4111-8111-${String(seq).padStart(12, '0')}`,
          resolution_code: null,
          resolved_by_id: null,
          authorization_comment: null,
          rejection_reason: null,
          system_reason: null,
          achievement_intent_key: null,
          ...data,
          achievement_intent_key: data.achievement_intent_key ?? null,
        };
        seq += 1;
        people.push(row);
        return row;
      },
    ),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { person_id: string };
        data: Partial<PersonSeed>;
      }) => {
        const row = people.find((item) => item.person_id === where.person_id);
        if (!row) {
          throw new Error('person missing');
        }
        Object.assign(row, data);
        if (options?.pauseOnRemove && data.status === 'REMOVED' && !didPause) {
          didPause = true;
          markEntered();
          await paused;
        }
        return row;
      },
    ),
    updateMany: jest.fn(
      async ({ where, data }: { where: object; data: Partial<PersonSeed> }) => {
        const matched = people.filter((row) => matchesPerson(row, where));
        for (const row of matched) {
          Object.assign(row, data);
        }
        return { count: matched.length };
      },
    ),
  };

  const requestsDelegate = {
    create: jest.fn(
      async ({ data }: { data: Omit<RequestSeed, 'request_id'> }) => {
        const row: RequestSeed = {
          request_id: `22222222-2222-4222-8222-${String(seq).padStart(12, '0')}`,
          created_at: SEED_CREATED_AT,
          ...data,
        };
        seq += 1;
        requests.push(row);
        return row;
      },
    ),
    findUnique: jest.fn(
      async ({
        where,
        select,
      }: {
        where: { request_id: string };
        select?: { people?: unknown };
      }) => {
        const row = requests.find(
          (item) => item.request_id === where.request_id,
        );
        if (!row) {
          return null;
        }
        if (select?.people) {
          return {
            created_at: SEED_CREATED_AT,
            ...row,
            people: people
              .filter((person) => person.request_id === row.request_id)
              .sort((left, right) =>
                left.person_id.localeCompare(right.person_id),
              ),
          };
        }
        return row;
      },
    ),
    findMany: jest.fn(
      async ({
        where,
        select,
      }: {
        select?: { people?: unknown };
        where?: {
          request_id?: { in: string[] };
          ecclesiastical_year_id?: number;
          club_section_id?: { in: number[] };
          people?: { some?: { status?: string; resolution_code?: string } };
          OR?: Array<{
            people?: {
              some?: {
                status?: string;
                resolution_code?: string;
                system_reason?: string;
              };
            };
          }>;
        };
      }) => {
        const matched = requests.filter((row) => {
          if (
            where?.request_id?.in &&
            !where.request_id.in.includes(row.request_id)
          ) {
            return false;
          }
          if (
            where?.ecclesiastical_year_id !== undefined &&
            row.ecclesiastical_year_id !== where.ecclesiastical_year_id
          ) {
            return false;
          }
          if (
            where?.club_section_id?.in &&
            !where.club_section_id.in.includes(row.club_section_id)
          ) {
            return false;
          }
          const clauses =
            where?.OR ?? (where?.people ? [{ people: where.people }] : []);
          if (clauses.length > 0) {
            const matches = clauses.some((clause) => {
              const some = clause.people?.some;
              if (!some) return false;
              return people.some((person) => {
                if (person.request_id !== row.request_id) return false;
                if (some.status && person.status !== some.status) return false;
                if (
                  some.resolution_code &&
                  person.resolution_code !== some.resolution_code
                ) {
                  return false;
                }
                if (
                  some.system_reason &&
                  person.system_reason !== some.system_reason
                ) {
                  return false;
                }
                return Boolean(
                  some.status || some.resolution_code || some.system_reason,
                );
              });
            });
            if (!matches) return false;
          }
          return true;
        });
        if (!select?.people) {
          return matched;
        }
        return matched.map((row) => ({
          created_at: SEED_CREATED_AT,
          ...row,
          people: people
            .filter((person) => person.request_id === row.request_id)
            .sort((left, right) =>
              left.person_id.localeCompare(right.person_id),
            ),
        }));
      },
    ),
  };

  const shared = {
    enrollments: {
      findUnique: jest.fn(
        async ({ where }: { where: { enrollment_id: number } }) => {
          return (
            enrollments.find(
              (row) => row.enrollment_id === where.enrollment_id,
            ) ?? null
          );
        },
      ),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            user_id?: string;
            class_id?: number;
            enrollment_id?: number;
            investiture_status?: string;
            record_kind?: string;
            classes?: { club_types?: { name?: string } };
          };
        }) => {
          const typeName = where.classes?.club_types?.name;
          return (
            enrollments.find((row) => {
              if (where.user_id && row.user_id !== where.user_id) {
                return false;
              }
              if (
                where.investiture_status &&
                row.investiture_status !== where.investiture_status
              ) {
                return false;
              }
              if (
                where.class_id !== undefined &&
                row.class_id !== where.class_id
              ) {
                return false;
              }
              if (
                where.enrollment_id !== undefined &&
                row.enrollment_id !== where.enrollment_id
              ) {
                return false;
              }
              if (where.record_kind && row.record_kind !== where.record_kind) {
                return false;
              }
              if (typeName && row.classes?.club_types?.name !== typeName) {
                return false;
              }
              return true;
            }) ?? null
          );
        },
      ),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            active?: boolean;
            record_kind?: string;
            cross_type_enrollment?: boolean;
            user_id?: { in: string[] };
            investiture_status?: string | { not?: string };
            classes?: { club_type_id?: number };
            users?: {
              club_role_assignments?: {
                some?: {
                  club_section_id?: number;
                  ecclesiastical_year_id: number;
                  active: boolean;
                  status: string;
                  club_sections?: {
                    main_club_id?: number;
                    club_section_id?: { not: number };
                    club_type_id?: { not: number };
                  };
                };
              };
            };
          };
        }) => {
          const some = where.users?.club_role_assignments?.some;
          return enrollments
            .filter((row) => {
              if (where.active !== undefined && row.active !== where.active) {
                return false;
              }
              if (where.record_kind && row.record_kind !== where.record_kind) {
                return false;
              }
              if (
                where.cross_type_enrollment !== undefined &&
                row.cross_type_enrollment !== where.cross_type_enrollment
              ) {
                return false;
              }
              if (where.user_id && !where.user_id.in.includes(row.user_id)) {
                return false;
              }
              if (
                typeof where.investiture_status === 'string' &&
                row.investiture_status !== where.investiture_status
              ) {
                return false;
              }
              if (
                typeof where.investiture_status === 'object' &&
                where.investiture_status.not &&
                row.investiture_status === where.investiture_status.not
              ) {
                return false;
              }
              if (
                where.classes?.club_type_id !== undefined &&
                row.classes?.club_type_id !== where.classes.club_type_id
              ) {
                return false;
              }
              if (!some) {
                return true;
              }
              return members.some((member) => {
                const nested = some.club_sections;
                return (
                  member.user_id === row.user_id &&
                  member.ecclesiastical_year_id ===
                    some.ecclesiastical_year_id &&
                  member.active === some.active &&
                  member.status === some.status &&
                  (some.club_section_id === undefined ||
                    member.club_section_id === some.club_section_id) &&
                  (nested?.main_club_id === undefined ||
                    member.main_club_id === nested.main_club_id) &&
                  (nested?.club_section_id?.not === undefined ||
                    member.club_section_id !== nested.club_section_id.not) &&
                  (nested?.club_type_id?.not === undefined ||
                    member.club_type_id !== nested.club_type_id.not)
                );
              });
            })
            .map((row) => ({
              ...row,
              users: userNames.has(row.user_id)
                ? { name: userNames.get(row.user_id), paternal_last_name: null }
                : null,
            }));
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            enrollment_id?: number;
            investiture_status?: string;
          };
          data: Partial<EnrollmentSeed>;
        }) => {
          const rows = enrollments.filter((row) => {
            if (
              where.enrollment_id !== undefined &&
              row.enrollment_id !== where.enrollment_id
            ) {
              return false;
            }
            if (
              where.investiture_status &&
              row.investiture_status !== where.investiture_status
            ) {
              return false;
            }
            return true;
          });
          for (const row of rows) {
            Object.assign(row, data);
          }
          return { count: rows.length };
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { enrollment_id: number };
          data: Partial<EnrollmentSeed>;
        }) => {
          const row = enrollments.find(
            (item) => item.enrollment_id === where.enrollment_id,
          );
          if (!row) {
            throw new Error('enrollment missing');
          }
          Object.assign(row, data);
          return row;
        },
      ),
    },
    club_sections: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where?: {
            active?: boolean;
            club_section_id?: { in: number[] };
            clubs?: {
              local_field_id?: number;
              churches?: { districlub_type_id?: { in: number[] } };
            };
          };
        }) => {
          return sections.filter((row) => {
            if (where?.active !== undefined && row.active !== where.active) {
              return false;
            }
            if (
              where?.club_section_id?.in &&
              !where.club_section_id.in.includes(row.club_section_id)
            ) {
              return false;
            }
            const clubs = where?.clubs;
            if (!clubs) {
              return true;
            }
            if (
              clubs.local_field_id !== undefined &&
              row.clubs.local_field_id !== clubs.local_field_id
            ) {
              return false;
            }
            const districts = clubs.churches?.districlub_type_id?.in;
            if (
              districts &&
              !districts.includes(row.clubs.churches.districlub_type_id)
            ) {
              return false;
            }
            return true;
          });
        },
      ),
      // Models the real Prisma delegate: club_sections has no `name` column and
      // `club_types` is a relation, present only when the query selects or
      // includes it (BCR-1).
      findUnique: jest.fn(
        async ({
          where,
          select,
          include,
        }: {
          where: { club_section_id: number };
          select?: Record<string, unknown>;
          include?: Record<string, unknown>;
        }) => {
          const row = sections.find(
            (item) => item.club_section_id === where.club_section_id,
          ) as Record<string, unknown> | undefined;
          if (!row) {
            return null;
          }
          const { club_types: relation, ...columns } = row;
          if (select) {
            const picked: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              if (!select[key]) {
                continue;
              }
              picked[key] = key === 'club_types' ? relation : columns[key];
            }
            return picked;
          }
          return include?.club_types
            ? { ...columns, club_types: relation }
            : columns;
        },
      ),
    },
    ecclesiastical_years: {
      findUnique: jest.fn(async ({ where }: { where: { year_id: number } }) => {
        return where.year_id === year.year_id ? year : null;
      }),
      count: jest.fn(async () => yearCount),
      // Same figure as `count`: `yearCount` ecclesiastical years inside the
      // requested range, so both ways of counting elapsed years agree.
      findMany: jest.fn(
        async ({
          where,
        }: {
          where?: { start_date?: { gte?: Date; lte?: Date } };
        }) => {
          const range = where?.start_date;
          return Array.from({ length: yearCount }, () => ({
            start_date: year.start_date,
          })).filter(
            (row) =>
              (!range?.gte || row.start_date >= range.gte) &&
              (!range?.lte || row.start_date <= range.lte),
          );
        },
      ),
    },
    local_field_investiture_windows: {
      findUnique: jest.fn(async () => windowRow),
    },
    club_role_assignments: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            user_id: string;
            club_section_id?: number;
            ecclesiastical_year_id: number;
            active: boolean;
            status: string;
            club_sections?: {
              main_club_id?: number;
              club_section_id?: { not: number };
              club_type_id?: { not: number };
            };
          };
        }) => {
          return (
            members.find((row) => {
              if (row.user_id !== where.user_id) {
                return false;
              }
              if (row.ecclesiastical_year_id !== where.ecclesiastical_year_id) {
                return false;
              }
              if (row.active !== where.active || row.status !== where.status) {
                return false;
              }
              if (
                where.club_section_id !== undefined &&
                row.club_section_id !== where.club_section_id
              ) {
                return false;
              }
              const nested = where.club_sections;
              if (!nested) {
                return true;
              }
              if (
                nested.main_club_id !== undefined &&
                row.main_club_id !== nested.main_club_id
              ) {
                return false;
              }
              if (
                nested.club_section_id?.not !== undefined &&
                row.club_section_id === nested.club_section_id.not
              ) {
                return false;
              }
              if (
                nested.club_type_id?.not !== undefined &&
                row.club_type_id === nested.club_type_id.not
              ) {
                return false;
              }
              return true;
            }) ?? null
          );
        },
      ),
    },
    investiture_authorization_people: peopleDelegate,
    investiture_authorization_requests: requestsDelegate,
    users: {
      findMany: jest.fn(
        async ({ where }: { where: { user_id: { in: string[] } } }) =>
          where.user_id.in.map((id) => ({
            user_id: id,
            active: !deletedAccounts.has(id),
            users_roles: [{ user_role_id: 'role-pastor' }],
          })),
      ),
    },
    district_investiture_pastors: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            user_id: string;
            districlub_type_id: number;
            active: boolean;
          };
        }) => {
          return (
            pastors.find(
              (row) =>
                row.user_id === where.user_id &&
                row.districlub_type_id === where.districlub_type_id &&
                row.active === where.active,
            ) ?? null
          );
        },
      ),
      findMany: jest.fn(
        async ({ where }: { where: { user_id: string; active: boolean } }) => {
          return pastors.filter(
            (row) =>
              row.user_id === where.user_id && row.active === where.active,
          );
        },
      ),
    },
    achievement_event_log: {
      findMany: jest.fn(async () => []),
    },
  };

  const prisma = {
    ...shared,
    $executeRaw: jest.fn(async () => 0),
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      const token = Symbol('tx');
      const tx = {
        ...shared,
        $executeRaw: async (sql: unknown) => {
          const record =
            sql && typeof sql === 'object'
              ? (sql as { strings?: string[]; values?: unknown[] })
              : {};
          const text = Array.isArray(record.strings)
            ? record.strings.join('?')
            : String(sql);
          if (text.includes('pg_advisory_xact_lock')) {
            if (lockHookArmed && !lockHookUsed && lockHook) {
              lockHookUsed = true;
              lockHook();
            }
            await acquire(token, JSON.stringify(record.values ?? []));
          }
          return 0;
        },
      };
      return fn(tx).finally(() => {
        release(token);
      });
    },
  };

  return {
    prisma,
    people,
    requests,
    year,
    section,
    entered,
    releasePause,
    setYearCount(value: number) {
      yearCount = value;
    },
    setWindow(start: string, end: string) {
      windowRow = {
        start_date: new Date(`${start}T00:00:00.000Z`),
        end_date: new Date(`${end}T00:00:00.000Z`),
      };
    },
    clearMembers() {
      members.length = 0;
    },
    setUserName(userId: string, name: string) {
      userNames.set(userId, name);
    },
    addSection(row: {
      club_section_id: number;
      club_type_id: number;
      main_club_id: number;
      club_types?: { name: string };
      clubs?: typeof section.clubs;
    }) {
      sections.push({
        club_section_id: row.club_section_id,
        club_type_id: row.club_type_id,
        active: true,
        main_club_id: row.main_club_id,
        clubs: row.clubs ?? section.clubs,
        ...(row.club_types ? { club_types: row.club_types } : {}),
      } as (typeof sections)[number]);
    },
    addMember(
      userId = USER,
      sectionId = SECTION_ID,
      scope: { club_type_id?: number; main_club_id?: number } = {},
    ) {
      const target = sections.find((row) => row.club_section_id === sectionId);
      members.push({
        assignment_id: `member-${members.length + 1}`,
        user_id: userId,
        club_section_id: sectionId,
        club_type_id: scope.club_type_id ?? target?.club_type_id ?? 1,
        main_club_id: scope.main_club_id ?? target?.main_club_id ?? 1,
        ecclesiastical_year_id: YEAR_ID,
        active: true,
        status: 'active',
      });
    },
    assignPastor(userId = ACTOR, districtId = 3) {
      pastors.push({
        user_id: userId,
        districlub_type_id: districtId,
        active: true,
      });
    },
    deleteAccount(userId = ACTOR) {
      deletedAccounts.add(userId);
    },
    deactivatePastor() {
      for (const row of pastors) {
        row.active = false;
      }
    },
    armLockHook(hook?: () => void) {
      if (hook) {
        lockHook = hook;
      }
      lockHookArmed = true;
      lockHookUsed = false;
    },
    addEnrollment(overrides: Partial<EnrollmentSeed> = {}): EnrollmentSeed {
      const row: EnrollmentSeed = {
        enrollment_id: overrides.enrollment_id ?? enrollments.length + 901,
        user_id: USER,
        class_id: 7,
        ecclesiastical_year_id: YEAR_ID,
        investiture_status: 'IN_PROGRESS',
        locked_for_validation: false,
        record_kind: 'OPERATIONAL',
        cross_type_enrollment: false,
        active: true,
        classes: {
          min_duration_years: 1,
          max_duration_years: 1,
          club_type_id: section.club_type_id,
          club_types: { name: 'Conquistadores' },
        },
        ecclesiastical_year: { start_date: year.start_date },
        ...overrides,
      };
      enrollments.push(row);
      return row;
    },
  };
}

function bind(world: ReturnType<typeof createWorld>) {
  const eligibility = {
    calculateForEnrollment: jest.fn(async () => ({
      investiture_eligibility: { eligible: true },
    })),
    calculateForEnrollments: jest.fn(async (ids: number[]) => {
      return new Map(
        ids.map((id) => [
          id,
          { investiture_eligibility: { eligible: true }, overall_progress: 80 },
        ]),
      );
    }),
  };
  const achievements = {
    emitEvent: jest.fn(async () => ({ eventLogId: 1, queued: false })),
  };
  const service = new InvestitureAuthorizationRequestService(
    world.prisma as never,
    eligibility as never,
    achievements as never,
  );
  return { service, eligibility, achievements };
}

describe('investiture authorization requests', () => {
  let world: ReturnType<typeof createWorld>;
  let service: InvestitureAuthorizationRequestService;
  let eligibility: ReturnType<typeof bind>['eligibility'];
  let achievements: ReturnType<typeof bind>['achievements'];

  beforeEach(() => {
    world = createWorld();
    world.addMember();
    world.addEnrollment({ enrollment_id: 901 });
    ({ service, eligibility, achievements } = bind(world));
  });

  function present(
    enrollmentIds = [901],
    date = DATE,
    now = INSIDE,
    authorization = director(),
    sectionId = SECTION_ID,
  ) {
    return service.present(
      authorization,
      ACTOR,
      sectionId,
      YEAR_ID,
      date,
      enrollmentIds,
      now,
    );
  }

  function institutionalClass(assetCode: 'GM-02' | 'GM-03') {
    return {
      min_duration_years: 1,
      max_duration_years: 1,
      club_type_id: 1,
      club_types: { name: 'Conquistadores' },
      asset_code: assetCode,
    };
  }

  it('IA-62 rejects presenting GM-02 without creating a person', async () => {
    world.addEnrollment({
      enrollment_id: 977,
      classes: institutionalClass('GM-02'),
    });

    await expect(present([977])).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_CLASS_NOT_ELIGIBLE,
    });

    expect(world.people).toHaveLength(0);
  });

  it('IA-62 rejects adding GM-03 without creating a person', async () => {
    world.addEnrollment({
      enrollment_id: 978,
      classes: institutionalClass('GM-03'),
    });
    const request =
      await world.prisma.investiture_authorization_requests.create({
        data: {
          club_section_id: SECTION_ID,
          ecclesiastical_year_id: YEAR_ID,
          created_by_id: ACTOR,
        },
      });

    await expect(
      service.addPeople(
        director(),
        ACTOR,
        request.request_id,
        DATE,
        [978],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_CLASS_NOT_ELIGIBLE,
    });

    expect(world.people).toHaveLength(0);
    expect(achievements.emitEvent).not.toHaveBeenCalled();
  });

  it('IA61-H4 retires a prior GM-02 person without investing or a requirements reason', async () => {
    world.addEnrollment({
      enrollment_id: 979,
      classes: institutionalClass('GM-02'),
    });
    const request =
      await world.prisma.investiture_authorization_requests.create({
        data: {
          club_section_id: SECTION_ID,
          ecclesiastical_year_id: YEAR_ID,
          created_by_id: ACTOR,
        },
      });
    const person = await world.prisma.investiture_authorization_people.create({
      data: {
        request_id: request.request_id,
        user_id: USER,
        class_id: 7,
        enrollment_id: 979,
        investiture_date: new Date(`${DATE}T00:00:00.000Z`),
        status: 'PENDING',
        single_slot: false,
      },
    });

    await service.resolve(
      fieldDirector(),
      ACTOR,
      request.request_id,
      { invest: [{ person_id: person.person_id }] },
      INSIDE,
    );

    expect(person.status).toBe('REMOVED');
    expect(person.resolution_code).toBe('CLASS_NOT_ELIGIBLE');
    expect(person.system_reason ?? '').not.toContain('requisitos');
    expect(person.rejection_reason ?? '').not.toContain('requisitos');
    expect(achievements.emitEvent).not.toHaveBeenCalled();
  });

  it('IA61-H4 retires a prior GM-02 person and still resolves the eligible person', async () => {
    const institutionalEnrollment = world.addEnrollment({
      enrollment_id: 979,
      classes: institutionalClass('GM-02'),
    });
    const eligibleEnrollment = world.addEnrollment({
      enrollment_id: 980,
      class_id: 8,
    });
    world.addMember('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const request =
      await world.prisma.investiture_authorization_requests.create({
        data: {
          club_section_id: SECTION_ID,
          ecclesiastical_year_id: YEAR_ID,
          created_by_id: ACTOR,
        },
      });
    const institutional =
      await world.prisma.investiture_authorization_people.create({
        data: {
          request_id: request.request_id,
          user_id: USER,
          class_id: 7,
          enrollment_id: 979,
          investiture_date: new Date(`${DATE}T00:00:00.000Z`),
          status: 'PENDING',
          single_slot: false,
        },
      });
    const eligible = await world.prisma.investiture_authorization_people.create(
      {
        data: {
          request_id: request.request_id,
          user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          class_id: 8,
          enrollment_id: 980,
          investiture_date: new Date(`${DATE}T00:00:00.000Z`),
          status: 'PENDING',
          single_slot: false,
        },
      },
    );

    await service.resolve(
      fieldDirector(),
      ACTOR,
      request.request_id,
      {
        invest: [
          { person_id: institutional.person_id },
          { person_id: eligible.person_id },
        ],
      },
      INSIDE,
    );

    expect(institutional.status).toBe('REMOVED');
    expect(institutional.resolution_code).toBe('CLASS_NOT_ELIGIBLE');
    expect(institutional.system_reason ?? '').not.toContain('requisitos');
    expect(institutional.rejection_reason ?? '').not.toContain('requisitos');
    expect(eligible.status).toBe('INVESTED');
    expect(institutionalEnrollment.investiture_status).not.toBe('INVESTIDO');
    expect(eligibleEnrollment.investiture_status).toBe('INVESTIDO');
  });

  it.each([
    ['America/Tijuana', '2026-01-01T07:30:00.000Z', false],
    ['America/Tijuana', '2026-01-01T08:30:00.000Z', true],
    ['America/Bogota', '2026-01-01T04:30:00.000Z', false],
    ['America/Bogota', '2026-01-01T05:30:00.000Z', true],
  ] as const)(
    'C1RR-2 pastor authorization treats an active year in %s at %s as ended=%s',
    async (timeZone, instant, ended) => {
      world.year.start_date = new Date('2025-01-01T00:00:00.000Z');
      world.year.end_date = new Date('2025-12-31T00:00:00.000Z');
      world.year.active = true;
      world.section.clubs.local_fields.timezone = timeZone;
      world.setWindow('2025-10-01', '2025-12-31');
      const action = service.present(
        director(),
        ACTOR,
        SECTION_ID,
        YEAR_ID,
        '2025-11-01',
        [901],
        new Date(instant),
      );
      if (ended) {
        await expect(action).rejects.toMatchObject({
          code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
        });
      } else {
        await expect(action).resolves.toEqual(
          expect.objectContaining({ request_id: expect.any(String) }),
        );
      }
    },
  );

  it('IA-61 shows the later certificate note on the section request', async () => {
    const view = await present();
    const person = world.people.find(
      (row) => row.person_id === view.people[0].person_id,
    );
    if (!person) {
      throw new Error('person missing');
    }
    person.status = 'CLOSED_YEAR';
    person.resolution_code = 'CLOSED_YEAR';
    person.system_reason =
      'Investidura acreditada posteriormente mediante certificado validado';

    const listed = await service.list(director(), SECTION_ID, YEAR_ID);

    expect(listed?.people[0]).toMatchObject({
      status: 'CLOSED_YEAR',
      resolution_code: 'CLOSED_YEAR',
      system_reason:
        'Investidura acreditada posteriormente mediante certificado validado',
    });
  });

  it('IA-61 shows the later certificate note to the field authorizer', async () => {
    const note =
      'Investidura acreditada posteriormente mediante certificado validado';
    const view = await present();
    const person = world.people.find(
      (row) => row.person_id === view.people[0].person_id,
    );
    if (!person) {
      throw new Error('person missing');
    }
    person.status = 'CLOSED_YEAR';
    person.resolution_code = 'CLOSED_YEAR';
    person.system_reason = note;

    const listed = await service.listForAuthorizer(
      fieldDirector(),
      ACTOR,
      YEAR_ID,
    );

    expect(listed).toHaveLength(1);
    expect(listed[0].people[0]).toMatchObject({
      status: 'CLOSED_YEAR',
      system_reason: note,
    });
  });

  it('marks one section request and keeps can_authorize while pending', async () => {
    const view = await present();

    expect(view.people).toHaveLength(1);
    expect(view.people[0]).toMatchObject({
      enrollment_id: 901,
      investiture_date: DATE,
      status: 'PENDING',
      can_authorize: true,
    });
    expect(view.club_section_id).toBe(SECTION_ID);
  });

  it('reuses one request and one date for several people', async () => {
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    world.addMember('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    const view = await present([901, 902]);

    expect(world.requests).toHaveLength(1);
    expect(view.people.map((person) => person.investiture_date)).toEqual([
      DATE,
      DATE,
    ]);
  });

  it('dedupes the same enrollment', async () => {
    const view = await present([901, 901]);

    expect(view.people).toHaveLength(1);
  });

  it('rejects an empty selection', async () => {
    await expect(present([])).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_EMPTY,
    });
  });

  it('rejects a deputy on mark, list, remove and date change', async () => {
    const view = await present();
    const deputy = director('deputy-director');

    await expect(present([901], DATE, INSIDE, deputy)).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    await expect(
      service.list(deputy, SECTION_ID, YEAR_ID),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    await expect(
      service.remove(
        deputy,
        ACTOR,
        view.request_id,
        view.people[0].person_id,
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    await expect(
      service.changeDates(
        deputy,
        ACTOR,
        view.request_id,
        '2026-11-15',
        [view.people[0].person_id],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    await expect(
      service.addPeople(
        deputy,
        ACTOR,
        view.request_id,
        '2026-11-15',
        [902],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
  });

  it('lets a director win when the same person is also deputy', async () => {
    const view = await present(
      [901],
      DATE,
      INSIDE,
      snapshot(['deputy-director', 'director'], []),
    );

    expect(view.people[0].status).toBe('PENDING');
  });

  it('lets super-admin change the date and blocks them from presenting', async () => {
    const view = await present();
    const root = snapshot([], ['super-admin']);

    await expect(present([901], DATE, INSIDE, root)).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    const changed = await service.changeDates(
      root,
      ACTOR,
      view.request_id,
      '2026-11-20',
      [view.people[0].person_id],
      OUTSIDE,
    );

    expect(changed.people[0].investiture_date).toBe('2026-11-20');
  });

  it('rejects a date outside the window, the year, or the civil calendar', async () => {
    await expect(present([901], '2026-09-01')).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_DATE_OUTSIDE_WINDOW,
    });
    await expect(present([901], '2027-01-02')).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_DATE_OUTSIDE_YEAR,
    });
    await expect(present([901], '2026-02-31')).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_DATE_INVALID,
    });
  });

  it('rejects present when today is outside the window even if the date is valid', async () => {
    await expect(present([901], DATE, OUTSIDE)).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
    });
    expect(world.people).toHaveLength(0);
  });

  it('still corrects a pending date when today is outside the window', async () => {
    const view = await present();

    const changed = await service.changeDates(
      director(),
      ACTOR,
      view.request_id,
      '2026-12-01',
      [view.people[0].person_id],
      OUTSIDE,
    );

    expect(changed.people[0].investiture_date).toBe('2026-12-01');
  });

  it('keeps the window closed when the year does not intersect October', async () => {
    world.year.end_date = new Date('2026-06-30T00:00:00.000Z');

    await expect(
      present([901], '2026-03-01', new Date('2026-03-15T18:00:00.000Z')),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
    });
  });

  it('uses an explicit window and ignores a date outside it', async () => {
    world.setWindow('2026-11-01', '2026-11-10');

    await expect(
      present([901], '2026-11-15', new Date('2026-11-05T18:00:00.000Z')),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_DATE_OUTSIDE_WINDOW,
    });
    const view = await present(
      [901],
      '2026-11-05',
      new Date('2026-11-05T18:00:00.000Z'),
    );
    expect(view.people[0].investiture_date).toBe('2026-11-05');
  });

  it('rejects present and date changes when the year is closed', async () => {
    world.year.active = false;
    await expect(present()).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });

    world.year.active = true;
    const view = await present();
    world.year.active = false;
    await expect(
      service.changeDates(
        director(),
        ACTOR,
        view.request_id,
        '2026-11-15',
        [view.people[0].person_id],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
    expect(world.people[0].investiture_date.toISOString().slice(0, 10)).toBe(
      DATE,
    );
  });

  it('blocks a second active Aventurero or Conquistador class for the same person', async () => {
    world.addEnrollment({ enrollment_id: 902, class_id: 8 });
    await present();

    await expect(present([902], '2026-11-15')).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_ACTIVE_EXISTS,
    });
    expect(world.people.filter((row) => row.status === 'PENDING')).toHaveLength(
      1,
    );
  });

  it('allows two Guía Mayor classes and rejects a duplicate of the same class', async () => {
    world.section.club_type_id = 3;
    const first = world.addEnrollment({
      enrollment_id: 911,
      class_id: 30,
      classes: {
        min_duration_years: 1,
        max_duration_years: 1,
        club_type_id: 3,
        club_types: { name: 'Guías Mayores' },
      },
    });
    world.addEnrollment({
      enrollment_id: 912,
      class_id: 31,
      classes: {
        min_duration_years: 1,
        max_duration_years: 1,
        club_type_id: 3,
        club_types: { name: 'Guías Mayores' },
      },
    });

    const view = await present([first.enrollment_id]);
    const added = await service.addPeople(
      director(),
      ACTOR,
      view.request_id,
      '2026-11-18',
      [912],
      INSIDE,
    );

    expect(added.people).toHaveLength(2);
    expect(
      added.people.map((person) => person.investiture_date).sort(),
    ).toEqual([DATE, '2026-11-18']);
    await expect(present([911], '2026-11-20')).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_ACTIVE_EXISTS,
    });
  });

  it('lets an invested Guía Mayor take two different cross-type classes', async () => {
    world.addEnrollment({
      enrollment_id: 930,
      class_id: 40,
      investiture_status: 'INVESTIDO',
      classes: {
        min_duration_years: 1,
        max_duration_years: 1,
        club_type_id: 3,
        club_types: { name: 'Guías Mayores' },
      },
    });
    world.addEnrollment({
      enrollment_id: 931,
      class_id: 7,
      cross_type_enrollment: true,
    });
    world.addEnrollment({
      enrollment_id: 932,
      class_id: 8,
      cross_type_enrollment: true,
    });

    const view = await present([931]);
    const added = await service.addPeople(
      director(),
      ACTOR,
      view.request_id,
      '2026-11-12',
      [932],
      INSIDE,
    );

    expect(
      added.people.filter((person) => person.status === 'PENDING'),
    ).toHaveLength(2);
    expect(
      world.people.find((row) => row.enrollment_id === 931)?.single_slot,
    ).toBe(false);
  });

  it('rejects a historical certificate, missing progress and short duration', async () => {
    world.addEnrollment({
      enrollment_id: 940,
      record_kind: 'HISTORICAL_CERTIFICATE',
    });
    await expect(present([940])).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_NOT_OPERATIONAL,
    });

    eligibility.calculateForEnrollment.mockResolvedValueOnce({
      investiture_eligibility: { eligible: false },
    });
    await expect(present()).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_NOT_ELIGIBLE,
    });

    const short = world.addEnrollment({
      enrollment_id: 941,
      user_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      classes: {
        min_duration_years: 3,
        max_duration_years: 3,
        club_type_id: 1,
        club_types: { name: 'Conquistadores' },
      },
    });
    world.addMember(short.user_id);
    world.setYearCount(1);
    await expect(present([941])).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_DURATION_MIN_NOT_MET,
    });
  });

  it('admits the second year of a two-year class and keeps the original enrollment', async () => {
    const person = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const started = world.addEnrollment({
      enrollment_id: 970,
      user_id: person,
      ecclesiastical_year_id: 2025,
      ecclesiastical_year: {
        start_date: new Date('2025-01-01T00:00:00.000Z'),
      },
      classes: {
        min_duration_years: 2,
        max_duration_years: 3,
        club_type_id: 1,
        club_types: { name: 'Conquistadores' },
      },
    });
    world.addMember(person);
    world.setYearCount(1);
    await expect(present([started.enrollment_id])).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_DURATION_MIN_NOT_MET,
    });

    world.setYearCount(2);
    const view = await present([started.enrollment_id]);
    expect(view.people).toHaveLength(1);
    expect(started.ecclesiastical_year_id).toBe(2025);
    expect(
      world.people.filter((row) => row.enrollment_id === 970),
    ).toHaveLength(1);

    world.setYearCount(4);
    const expired = world.addEnrollment({
      enrollment_id: 971,
      user_id: 'abababab-abab-4aba-8aba-abababababab',
      ecclesiastical_year_id: 2023,
      ecclesiastical_year: {
        start_date: new Date('2023-01-01T00:00:00.000Z'),
      },
      classes: {
        min_duration_years: 1,
        max_duration_years: 3,
        club_type_id: 1,
        club_types: { name: 'Conquistadores' },
      },
    });
    world.addMember(expired.user_id);
    await expect(present([expired.enrollment_id])).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_DURATION_EXPIRED,
    });
    expect(expired.investiture_status).toBe('IN_PROGRESS');

    const closed = world.addEnrollment({
      enrollment_id: 972,
      user_id: 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd',
      investiture_status: 'EXPIRED',
    });
    world.addMember(closed.user_id);
    world.setYearCount(1);
    await expect(present([closed.enrollment_id])).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_DURATION_EXPIRED,
    });
  });

  it('presents a cross-type class from the class section of the same club', async () => {
    const homeSection = 8;
    const otherClubSection = 9;
    world.addSection({
      club_section_id: homeSection,
      club_type_id: 2,
      main_club_id: 1,
    });
    world.addSection({
      club_section_id: otherClubSection,
      club_type_id: 1,
      main_club_id: 2,
    });
    world.clearMembers();
    world.addMember(USER, homeSection, {
      club_type_id: 2,
      main_club_id: 1,
    });
    world.addEnrollment({
      enrollment_id: 980,
      class_id: 30,
      investiture_status: 'INVESTIDO',
      record_kind: 'HISTORICAL_CERTIFICATE',
      classes: {
        min_duration_years: 1,
        max_duration_years: 1,
        club_type_id: 2,
        club_types: { name: 'Guías Mayores' },
      },
    });
    const crossType = world.addEnrollment({
      enrollment_id: 981,
      class_id: 7,
      cross_type_enrollment: true,
    });

    await expect(
      present(
        [crossType.enrollment_id],
        DATE,
        INSIDE,
        director('director', homeSection),
        homeSection,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION,
    });
    await expect(
      present(
        [crossType.enrollment_id],
        DATE,
        INSIDE,
        director('director', otherClubSection),
        otherClubSection,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION,
    });

    const view = await present([crossType.enrollment_id]);
    expect(view.club_section_id).toBe(SECTION_ID);
    expect(view.people).toHaveLength(1);
    expect(world.people.filter((row) => row.status === 'PENDING')).toHaveLength(
      1,
    );

    const guideClass = world.addEnrollment({
      enrollment_id: 982,
      class_id: 31,
      classes: {
        min_duration_years: 1,
        max_duration_years: 1,
        club_type_id: 2,
        club_types: { name: 'Guías Mayores' },
      },
    });
    const guideRequest = await present(
      [guideClass.enrollment_id],
      DATE,
      INSIDE,
      director('director', homeSection),
      homeSection,
    );
    expect(guideRequest.request_id).not.toBe(view.request_id);
    expect(guideRequest.people).toHaveLength(1);
    const listed = await service.list(director(), SECTION_ID, YEAR_ID);
    expect(listed?.people.map((person) => person.enrollment_id)).toEqual([
      crossType.enrollment_id,
    ]);
  });

  it('rejects a cross-type class without an invested Guía Mayor', async () => {
    world.addSection({
      club_section_id: 8,
      club_type_id: 2,
      main_club_id: 1,
    });
    world.clearMembers();
    world.addMember(USER, 8, { club_type_id: 2, main_club_id: 1 });
    const crossType = world.addEnrollment({
      enrollment_id: 983,
      cross_type_enrollment: true,
    });

    await expect(present([crossType.enrollment_id])).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION,
    });
  });

  it('C1-H5 lists the informative request with the smallest request id', async () => {
    const later = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const earlier = '11111111-1111-4111-8111-111111111111';
    world.requests.push(
      {
        request_id: later,
        club_section_id: SECTION_ID,
        ecclesiastical_year_id: YEAR_ID,
        created_by_id: ACTOR,
      },
      {
        request_id: earlier,
        club_section_id: SECTION_ID,
        ecclesiastical_year_id: YEAR_ID,
        created_by_id: ACTOR,
      },
    );
    const informed = (
      requestId: string,
      personId: string,
      enrollmentId: number,
    ) => ({
      person_id: personId,
      request_id: requestId,
      user_id: USER,
      class_id: 4,
      enrollment_id: enrollmentId,
      investiture_date: new Date('2026-11-01T00:00:00.000Z'),
      status: 'REMOVED',
      single_slot: true,
      resolution_code: 'HISTORICAL_CERTIFICATE_APPLIED',
      resolved_by_id: null,
      authorization_comment: null,
      rejection_reason: null,
      system_reason: 'Investidura aplicada por certificado de un año anterior',
      achievement_intent_key: null,
    });
    world.people.push(
      informed(later, 'ffffffff-ffff-4fff-8fff-fffffffffff1', 801),
      informed(earlier, '11111111-1111-4111-8111-111111111101', 802),
    );

    const listed = await service.list(director(), SECTION_ID, YEAR_ID);

    expect(listed?.request_id).toBe(earlier);
  });

  it('keeps one section request when two different people are presented together', async () => {
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    world.addMember(other);
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: other,
    });

    const [first, second] = await Promise.all([present([901]), present([902])]);

    expect(world.requests).toHaveLength(1);
    expect(first.request_id).toBe(second.request_id);
    expect(world.people.filter((row) => row.status === 'PENDING')).toHaveLength(
      2,
    );
    const listed = await service.list(director(), SECTION_ID, YEAR_ID);
    expect(listed?.people).toHaveLength(2);
    expect(listed?.people.map((person) => person.enrollment_id).sort()).toEqual(
      [901, 902],
    );
  });

  it('rejects adding to an emptied request after another request is active', async () => {
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    world.addMember(other);
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: other,
    });
    const first = await present([901]);
    await service.remove(
      director(),
      ACTOR,
      first.request_id,
      first.people[0].person_id,
      INSIDE,
    );
    await expect(
      service.list(director(), SECTION_ID, YEAR_ID),
    ).resolves.toBeNull();

    const second = await present([902]);
    await expect(
      service.addPeople(
        director(),
        ACTOR,
        first.request_id,
        '2026-11-15',
        [901],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_STALE,
    });

    const pending = world.people.filter((row) => row.status === 'PENDING');
    expect(new Set(pending.map((row) => row.request_id)).size).toBe(1);
    const listed = await service.list(director(), SECTION_ID, YEAR_ID);
    expect(listed?.request_id).toBe(second.request_id);
    expect(
      listed?.people
        .filter((person) => person.status === 'PENDING')
        .map((person) => person.enrollment_id),
    ).toEqual(pending.map((row) => row.enrollment_id));
  });

  it('reuses an emptied request when it is the only one for the section', async () => {
    const first = await present([901]);
    await service.remove(
      director(),
      ACTOR,
      first.request_id,
      first.people[0].person_id,
      INSIDE,
    );

    const again = await service.addPeople(
      director(),
      ACTOR,
      first.request_id,
      '2026-11-15',
      [901],
      INSIDE,
    );

    expect(again.request_id).toBe(first.request_id);
    expect(
      again.people.filter((person) => person.status === 'PENDING'),
    ).toHaveLength(1);
    expect(world.requests).toHaveLength(1);
  });

  it('keeps one active request when add and present race', async () => {
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    world.addMember(other);
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: other,
    });
    const first = await present([901]);
    await service.remove(
      director(),
      ACTOR,
      first.request_id,
      first.people[0].person_id,
      INSIDE,
    );

    const results = await Promise.allSettled([
      service.addPeople(
        director(),
        ACTOR,
        first.request_id,
        '2026-11-15',
        [901],
        INSIDE,
      ),
      present([902]),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({
          code: ErrorCode.INVESTITURE_REQUEST_STALE,
        });
      }
    }

    const pending = world.people.filter((row) => row.status === 'PENDING');
    expect(new Set(pending.map((row) => row.request_id)).size).toBe(1);
    const listed = await service.list(director(), SECTION_ID, YEAR_ID);
    expect(
      listed?.people
        .filter((person) => person.status === 'PENDING')
        .map((person) => person.enrollment_id)
        .sort(),
    ).toEqual(pending.map((row) => row.enrollment_id).sort());
  });

  it('rejects someone outside the section', async () => {
    const outsider = world.addEnrollment({
      enrollment_id: 950,
      user_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    });

    await expect(present([outsider.enrollment_id])).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION,
    });
  });

  it('does not rewrite existing people when adding with another date', async () => {
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    world.addMember('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const view = await present();

    const added = await service.addPeople(
      director(),
      ACTOR,
      view.request_id,
      '2026-11-15',
      [902],
      INSIDE,
    );

    const original = added.people.find(
      (person) => person.enrollment_id === 901,
    );
    const extra = added.people.find((person) => person.enrollment_id === 902);
    expect(original?.investiture_date).toBe(DATE);
    expect(extra?.investiture_date).toBe('2026-11-15');
  });

  it('changes only the selected pending people', async () => {
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    world.addMember('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const view = await present([901]);
    const added = await service.addPeople(
      director(),
      ACTOR,
      view.request_id,
      '2026-11-08',
      [902],
      INSIDE,
    );
    const selected = added.people.find(
      (person) => person.enrollment_id === 901,
    );
    const other = added.people.find((person) => person.enrollment_id === 902);

    const changed = await service.changeDates(
      director(),
      ACTOR,
      view.request_id,
      '2026-11-20',
      [selected!.person_id],
      INSIDE,
    );

    expect(
      changed.people.find((person) => person.person_id === selected!.person_id)
        ?.investiture_date,
    ).toBe('2026-11-20');
    expect(
      changed.people.find((person) => person.person_id === other!.person_id)
        ?.investiture_date,
    ).toBe('2026-11-08');
  });

  it('does not change any date when one selected person is no longer pending', async () => {
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    world.addMember('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const view = await present([901, 902]);
    const [first, second] = view.people;
    await service.remove(
      director(),
      ACTOR,
      view.request_id,
      first.person_id,
      INSIDE,
    );

    await expect(
      service.changeDates(
        director(),
        ACTOR,
        view.request_id,
        '2026-11-20',
        [first.person_id, second.person_id],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_NOT_PENDING,
    });
    expect(
      world.people
        .find((row) => row.person_id === second.person_id)
        ?.investiture_date.toISOString()
        .slice(0, 10),
    ).toBe(DATE);
  });

  it('removes only the request lock and allows marking again', async () => {
    const view = await present();
    const removed = await service.remove(
      director(),
      ACTOR,
      view.request_id,
      view.people[0].person_id,
      INSIDE,
    );

    expect(removed).toMatchObject({
      status: 'REMOVED',
      can_authorize: false,
    });
    expect(world.people[0].resolution_code).toBe('REMOVED');
    const again = await present();
    expect(
      again.people.filter((person) => person.status === 'PENDING'),
    ).toHaveLength(1);
  });

  it('lets a secretary present', async () => {
    const view = await present([901], DATE, INSIDE, director('secretary'));

    expect(view.people[0].status).toBe('PENDING');
  });

  it('retires stale pending rows when the person is already invested', async () => {
    const view = await present();
    const current = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    if (!current) {
      throw new Error('enrollment missing');
    }
    current.investiture_status = 'INVESTIDO';

    await expect(present()).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_ALREADY_INVESTED,
    });
    expect(
      world.people.find(
        (person) => person.person_id === view.people[0].person_id,
      ),
    ).toMatchObject({
      status: 'REMOVED',
      resolution_code: 'ALREADY_INVESTED',
    });
  });

  it('rejects a presentation while the old pipeline still holds the enrollment', async () => {
    const enrollment = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    if (!enrollment) {
      throw new Error('enrollment missing');
    }
    enrollment.investiture_status = 'FIELD_APPROVED';
    enrollment.locked_for_validation = true;

    await expect(present()).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE,
    });
    expect(world.people).toHaveLength(0);
  });

  it('rejects adding a person locked by the old pipeline', async () => {
    world.addEnrollment({ enrollment_id: 901 });
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      investiture_status: 'CLUB_APPROVED',
      locked_for_validation: true,
    });
    const view = await present();

    await expect(
      service.addPeople(
        director(),
        ACTOR,
        view.request_id,
        '2026-11-15',
        [902],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE,
    });
    expect(
      world.people.filter((row) => row.enrollment_id === 902),
    ).toHaveLength(0);
  });

  it('adds a CLUB_APPROVED person once the legacy lock was released (phase 8)', async () => {
    world.addEnrollment({ enrollment_id: 901 });
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      investiture_status: 'CLUB_APPROVED',
      locked_for_validation: false,
    });
    world.addMember('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const view = await present();

    const added = await service.addPeople(
      director(),
      ACTOR,
      view.request_id,
      '2026-11-15',
      [902],
      INSIDE,
    );

    expect(
      added.people.find((person) => person.enrollment_id === 902),
    ).toBeDefined();
  });

  it('retires a pending person instead of investing when the old pipeline is still open', async () => {
    const view = await present();
    const enrollment = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    if (!enrollment) {
      throw new Error('enrollment missing');
    }
    enrollment.investiture_status = 'SUBMITTED_FOR_VALIDATION';
    enrollment.locked_for_validation = true;

    const resolved = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: view.people[0].person_id }] },
      INSIDE,
    );

    expect(resolved.invested).toHaveLength(0);
    expect(resolved.retired[0].status).toBe('REMOVED');
    expect(world.people[0]).toMatchObject({
      status: 'REMOVED',
      resolution_code: 'LEGACY_PIPELINE_ACTIVE',
    });
    expect(enrollment.investiture_status).toBe('SUBMITTED_FOR_VALIDATION');
    expect(achievements.emitEvent).not.toHaveBeenCalled();
    expect(world.people[0].rejection_reason ?? null).toBeNull();
    expect(world.people[0].system_reason ?? null).toBeNull();
  });

  it('keeps the other person invested when one enrollment no longer matches', async () => {
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: other,
    });
    world.addMember(other);
    const view = await present([901, 902]);
    const updateMany =
      world.prisma.enrollments.updateMany.getMockImplementation();
    world.prisma.enrollments.updateMany.mockImplementation(async (args) => {
      if (args.where?.enrollment_id === 902) {
        const row = await world.prisma.enrollments.findUnique({
          where: { enrollment_id: 902 },
        });
        if (row) {
          row.investiture_status = 'INVESTIDO';
        }
        return { count: 0 };
      }
      return updateMany?.(args);
    });

    const resolved = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      {
        invest: view.people.map((person) => ({ person_id: person.person_id })),
      },
      INSIDE,
    );

    expect(resolved.invested).toHaveLength(1);
    expect(achievements.emitEvent).toHaveBeenCalledTimes(1);
    expect(world.people.find((row) => row.enrollment_id === 902)).toMatchObject(
      {
        status: 'REMOVED',
        resolution_code: 'ALREADY_INVESTED',
      },
    );
    expect(world.people.find((row) => row.enrollment_id === 901)?.status).toBe(
      'INVESTED',
    );
  });

  it('invests once from FIELD_APPROVED when that confirm races the old invest', async () => {
    const view = await present();
    const enrollment = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    if (!enrollment) {
      throw new Error('enrollment missing');
    }
    enrollment.investiture_status = 'FIELD_APPROVED';
    enrollment.locked_for_validation = true;

    const resolved = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: view.people[0].person_id }] },
      INSIDE,
    );

    expect(resolved.invested).toHaveLength(1);
    expect(enrollment.investiture_status).toBe('INVESTIDO');
    expect(achievements.emitEvent).toHaveBeenCalledTimes(1);
    expect(world.people.filter((row) => row.status === 'PENDING')).toHaveLength(
      0,
    );
  });

  it('rejects presentation when another enrollment of the same class is invested', async () => {
    world.addEnrollment({
      enrollment_id: 904,
      investiture_status: 'INVESTIDO',
      record_kind: 'HISTORICAL_CERTIFICATE',
    });

    await expect(present()).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_ALREADY_INVESTED,
    });
    expect(world.people).toHaveLength(0);
  });

  it('rejects adding a class that already has an invested certificate', async () => {
    world.addEnrollment({ enrollment_id: 902, class_id: 8 });
    world.addEnrollment({
      enrollment_id: 905,
      class_id: 8,
      investiture_status: 'INVESTIDO',
      record_kind: 'HISTORICAL_CERTIFICATE',
    });
    const view = await present();

    await expect(
      service.addPeople(
        director(),
        ACTOR,
        view.request_id,
        '2026-11-15',
        [902],
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_ALREADY_INVESTED,
    });
  });

  it('removes a pending person when another enrollment of the class is invested', async () => {
    const view = await present();
    world.addEnrollment({
      enrollment_id: 906,
      investiture_status: 'INVESTIDO',
      record_kind: 'HISTORICAL_CERTIFICATE',
    });

    const resolved = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: view.people[0].person_id }] },
      INSIDE,
    );

    expect(resolved.invested).toHaveLength(0);
    expect(resolved.retired[0].status).toBe('REMOVED');
    expect(world.people[0]).toMatchObject({
      status: 'REMOVED',
      resolution_code: 'ALREADY_INVESTED',
    });
    expect(achievements.emitEvent).not.toHaveBeenCalled();
    const operational = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    expect(operational?.investiture_status).toBe('IN_PROGRESS');
  });

  it('returns null from list without inserting when nobody is pending', async () => {
    await expect(
      service.list(director(), SECTION_ID, YEAR_ID),
    ).resolves.toBeNull();
    expect(world.requests).toHaveLength(0);
  });

  it('lets exactly one of two simultaneous creates succeed', async () => {
    const racing = createWorld({ pauseOnPendingRead: true });
    racing.addMember();
    racing.addEnrollment({ enrollment_id: 901, class_id: 7 });
    racing.addEnrollment({ enrollment_id: 902, class_id: 8 });
    const { service: racingService } = bind(racing);
    const first = racingService.present(
      director(),
      ACTOR,
      SECTION_ID,
      YEAR_ID,
      DATE,
      [901],
      INSIDE,
    );
    const second = racingService.present(
      director(),
      ACTOR,
      SECTION_ID,
      YEAR_ID,
      '2026-11-15',
      [902],
      INSIDE,
    );
    await racing.entered;
    expect(racing.people).toHaveLength(0);
    racing.releasePause();

    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: 'rejected',
      reason: { code: ErrorCode.INVESTITURE_REQUEST_ACTIVE_EXISTS },
    });
    expect(
      racing.people.filter((row) => row.status === 'PENDING'),
    ).toHaveLength(1);
  });

  it('does not change the date of a person removed while the change waits', async () => {
    const racing = createWorld({ pauseOnRemove: true });
    racing.addMember();
    racing.addEnrollment({ enrollment_id: 901 });
    const { service: racingService } = bind(racing);
    const view = await racingService.present(
      director(),
      ACTOR,
      SECTION_ID,
      YEAR_ID,
      DATE,
      [901],
      INSIDE,
    );
    const personId = view.people[0].person_id;
    const removing = racingService.remove(
      director(),
      ACTOR,
      view.request_id,
      personId,
      INSIDE,
    );
    await racing.entered;
    const changing = racingService.changeDates(
      director(),
      ACTOR,
      view.request_id,
      '2026-11-20',
      [personId],
      INSIDE,
    );
    racing.releasePause();

    await removing;
    await expect(changing).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_NOT_PENDING,
    });
    expect(racing.people[0].investiture_date.toISOString().slice(0, 10)).toBe(
      DATE,
    );
    expect(racing.people[0].status).toBe('REMOVED');
  });

  function fieldDirector(fieldId = 10): AuthorizationSnapshot {
    return {
      grants: {
        global_roles: [
          {
            role_name: 'director-lf',
            permissions: [],
            scope: { local_field: { id: fieldId, name: 'Campo' } },
          },
        ],
        club_assignments: [],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        permissions: [],
        scope: {
          global: { local_field: { id: fieldId, name: 'Campo' } },
          club: null,
        },
      },
    };
  }

  it('invests from the field without FIELD_APPROVED and emits class.completed once', async () => {
    const view = await present();
    const personId = view.people[0].person_id;

    const resolved = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: personId, comment: '  ' }] },
      new Date('2026-12-10T18:00:00.000Z'),
    );

    expect(resolved.invested[0]).toMatchObject({
      status: 'INVESTED',
      authorization_comment: null,
      resolved_by_id: ACTOR,
    });
    const enrollment = world.prisma.enrollments;
    const stored = await enrollment.findUnique({
      where: { enrollment_id: 901 },
    });
    expect(stored?.investiture_status).toBe('INVESTIDO');
    expect(stored?.investiture_status).not.toBe('FIELD_APPROVED');
    expect(achievements.emitEvent).toHaveBeenCalledTimes(1);
    expect(achievements.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'class.completed' }),
    );

    await expect(
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        new Date('2026-12-10T18:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_ALREADY_RESOLVED,
    });
    expect(achievements.emitEvent).toHaveBeenCalledTimes(2);
    const firstCall = achievements.emitEvent.mock.calls[0][0] as {
      idempotencyKey?: string;
    };
    const secondCall = achievements.emitEvent.mock.calls[1][0] as {
      idempotencyKey?: string;
    };
    expect(firstCall.idempotencyKey).toBe(
      `investiture-authorization:${personId}`,
    );
    expect(secondCall.idempotencyKey).toBe(firstCall.idempotencyKey);
  });

  it('rejects a year closed while the authorization waits on its lock', async () => {
    const view = await present();
    world.armLockHook(() => {
      world.year.active = false;
    });

    await expect(
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: view.people[0].person_id }] },
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
    expect(world.people[0].status).toBe('PENDING');
    expect(achievements.emitEvent).not.toHaveBeenCalled();
  });

  it('authorizes on the last local day of the window', async () => {
    world.setWindow('2026-10-01', '2026-10-15');
    const view = await present([901], '2026-10-15');
    const resolved = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: view.people[0].person_id }] },
      INSIDE,
    );
    expect(resolved.invested).toHaveLength(1);
  });

  it('rejects a window closed while the authorization waits on its lock', async () => {
    const view = await present();
    world.armLockHook(() => {
      world.setWindow('2026-10-01', '2026-10-14');
    });
    await expect(
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: view.people[0].person_id }] },
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
    });
    expect(world.people[0].status).toBe('PENDING');
    expect(achievements.emitEvent).not.toHaveBeenCalled();
  });

  it('rejects a pastor removed while the authorization waits on its lock', async () => {
    world.assignPastor();
    const view = await present();
    world.armLockHook(() => {
      world.deactivatePastor();
    });

    await expect(
      service.resolve(
        snapshot([], ['pastor']),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: view.people[0].person_id }] },
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    expect(world.people[0].status).toBe('PENDING');
    expect(achievements.emitEvent).not.toHaveBeenCalled();
  });

  it('BCR-6 rejects and lists nothing for an assigned pastor whose account was deleted', async () => {
    world.assignPastor();
    const view = await present();
    world.deleteAccount();

    await expect(
      service.resolve(
        snapshot([], ['pastor']),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: view.people[0].person_id }] },
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    await expect(
      service.listForAuthorizer(snapshot([], ['pastor']), ACTOR, YEAR_ID),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    expect(world.people[0].status).toBe('PENDING');
    expect(achievements.emitEvent).not.toHaveBeenCalled();
  });

  it('rejects when the wait crosses midnight at the end of the window', async () => {
    let current = new Date('2026-12-21T05:59:59.000Z');
    const local = new InvestitureAuthorizationRequestService(
      world.prisma as never,
      eligibility as never,
      achievements as never,
      { now: () => current },
    );
    const view = await present();
    world.armLockHook(() => {
      current = new Date('2026-12-21T06:00:01.000Z');
    });

    await expect(
      local.resolve(fieldDirector(), ACTOR, view.request_id, {
        invest: [{ person_id: view.people[0].person_id }],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
    });
    const stored = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    expect(world.people[0].status).toBe('PENDING');
    expect(world.people[0].achievement_intent_key).toBeNull();
    expect(stored?.investiture_status).not.toBe('INVESTIDO');
    expect(achievements.emitEvent).not.toHaveBeenCalled();
  });

  it('rejects when the wait crosses midnight at the end of the year', async () => {
    world.setWindow('2026-10-01', '2026-12-31');
    let current = new Date('2027-01-01T05:59:59.000Z');
    const local = new InvestitureAuthorizationRequestService(
      world.prisma as never,
      eligibility as never,
      achievements as never,
      { now: () => current },
    );
    const view = await present();
    world.armLockHook(() => {
      current = new Date('2027-01-01T06:00:01.000Z');
    });

    await expect(
      local.resolve(fieldDirector(), ACTOR, view.request_id, {
        invest: [{ person_id: view.people[0].person_id }],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
    const stored = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    expect(world.people[0].status).toBe('PENDING');
    expect(stored?.investiture_status).not.toBe('INVESTIDO');
    expect(achievements.emitEvent).not.toHaveBeenCalled();
  });

  it('recovers one class.completed after the first insert fails', async () => {
    const view = await present();
    const personId = view.people[0].person_id;
    let failed = false;
    achievements.emitEvent.mockImplementation(async () => {
      if (!failed) {
        failed = true;
        throw new Error('insert failed');
      }
      return { eventLogId: 1, queued: false };
    });

    const resolved = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: personId }] },
      INSIDE,
    );
    expect(resolved.invested).toHaveLength(1);
    expect(world.people[0].achievement_intent_key).toBe(
      `investiture-authorization:${personId}`,
    );

    await expect(
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_ALREADY_RESOLVED,
    });
    expect(achievements.emitEvent).toHaveBeenCalledTimes(2);

    achievements.emitEvent.mockImplementation(async () => {
      throw new Error('insert failed');
    });
    await expect(
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        INSIDE,
      ),
    ).rejects.toThrow('insert failed');
  });

  it('delivers a confirmed intent after the year closes without resolving again', async () => {
    const view = await present();
    const personId = view.people[0].person_id;
    let failed = false;
    achievements.emitEvent.mockImplementation(async () => {
      if (!failed) {
        failed = true;
        throw new Error('insert failed');
      }
      return { eventLogId: 1, queued: true };
    });
    await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: personId }] },
      INSIDE,
    );
    world.year.active = false;
    world.deactivatePastor();

    await expect(
      service.resolve(fieldDirector(), ACTOR, view.request_id, {
        invest: [{ person_id: personId }],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
    expect(achievements.emitEvent).toHaveBeenCalledTimes(1);

    await expect(service.reconcileConfirmedAchievementIntents()).resolves.toBe(
      1,
    );
    expect(achievements.emitEvent).toHaveBeenCalledTimes(2);
    expect(world.people[0].status).toBe('INVESTED');
    const stored = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    expect(stored?.investiture_status).toBe('INVESTIDO');
  });

  it('reactivates one failed evaluation after the year closes', async () => {
    const rows: Array<{
      event_id: number;
      idempotency_key?: string;
      processed: boolean;
    }> = [];
    const eventStore = {
      achievement_event_log: {
        create: async (args: {
          data: { idempotency_key?: string; processed?: boolean };
        }) => {
          const row = {
            event_id: rows.length + 1,
            processed: false,
            ...args.data,
          };
          rows.push(row);
          return row;
        },
        findFirst: async (args: { where: { idempotency_key: string } }) =>
          rows.find(
            (row) => row.idempotency_key === args.where.idempotency_key,
          ) ?? null,
        findUnique: async (args: { where: { event_id: number } }) =>
          rows.find((row) => row.event_id === args.where.event_id) ?? null,
        findMany: async () => rows.filter((row) => row.processed),
      },
      $executeRaw: async () => 0,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(eventStore),
    };
    let state = 'waiting';
    let retries = 0;
    const queued = {
      id: '',
      attemptsMade: 3,
      getState: async () => state,
      retry: async (
        from: string,
        opts: { resetAttemptsMade?: boolean; resetAttemptsStarted?: boolean },
      ) => {
        if (state !== 'failed') {
          throw new Error(`Job ${queued.id} is not in the failed state.`);
        }
        expect(from).toBe('failed');
        expect(opts.resetAttemptsMade).toBe(true);
        expect(opts.resetAttemptsStarted).toBe(true);
        retries += 1;
        queued.attemptsMade = 0;
        state = 'waiting';
      },
    };
    const queue = {
      add: async (
        name: string,
        data: unknown,
        opts: { jobId?: string } = {},
      ) => {
        const probe = Object.create(Job.prototype) as {
          opts: { jobId?: string };
          name: string;
          validateOptions: (jobData: { data: string }) => void;
        };
        probe.opts = opts;
        probe.name = name;
        probe.validateOptions({ data: JSON.stringify(data ?? {}) });
        queued.id = opts.jobId ?? '';
        return queued;
      },
    };
    const durable = new AchievementsService(
      eventStore as never,
      {} as never,
      {} as never,
      queue as never,
    );
    const local = new InvestitureAuthorizationRequestService(
      world.prisma as never,
      eligibility as never,
      durable,
    );
    const view = await present();
    const personId = view.people[0].person_id;
    await local.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: personId }] },
      INSIDE,
    );
    expect(rows).toHaveLength(1);
    expect(retries).toBe(0);
    state = 'failed';
    world.year.active = false;

    await expect(
      local.resolve(fieldDirector(), ACTOR, view.request_id, {
        invest: [{ person_id: personId }],
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
    expect(retries).toBe(0);
    expect(rows).toHaveLength(1);

    await Promise.all([
      local.reconcileConfirmedAchievementIntents(),
      local.reconcileConfirmedAchievementIntents(),
    ]);
    expect(retries).toBe(1);
    expect(state).toBe('waiting');
    expect(queued.attemptsMade).toBe(0);
    expect(rows).toHaveLength(1);
    expect(world.people[0].status).toBe('INVESTED');
  });

  it('rejects authorizers outside the territory and roles that do not authorize', async () => {
    const view = await present();
    const personId = view.people[0].person_id;
    const attempt = (authorization: AuthorizationSnapshot) =>
      service.resolve(
        authorization,
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        INSIDE,
      );

    await expect(attempt(director())).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    await expect(attempt(snapshot([], ['admin']))).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    await expect(attempt(snapshot([], ['super-admin']))).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    await expect(
      attempt(snapshot([], ['director-union'])),
    ).rejects.toMatchObject({ code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN });
    await expect(attempt(snapshot([], ['director-dia']))).rejects.toMatchObject(
      {
        code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
      },
    );
    await expect(attempt(fieldDirector(99))).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    world.assignPastor(ACTOR, 9);
    await expect(attempt(snapshot([], ['pastor']))).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
    });
    const assistant = fieldDirector();
    assistant.grants.global_roles[0].role_name = 'assistant-lf';
    const resolved = await attempt(assistant);
    expect(resolved.invested).toHaveLength(1);
  });

  it('lets an assigned district pastor invest and keeps another person pending', async () => {
    world.assignPastor();
    world.addMember('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    const view = await present([901, 902]);
    const [first, second] = view.people;

    const resolved = await service.resolve(
      snapshot([], ['pastor']),
      ACTOR,
      view.request_id,
      {
        invest: [{ person_id: first.person_id, comment: 'Listo' }],
        reject: [],
      },
      INSIDE,
    );

    expect(resolved.invested).toHaveLength(1);
    expect(resolved.invested[0].authorization_comment).toBe('Listo');
    const listed = await service.readForAuthorizer(
      snapshot([], ['pastor']),
      ACTOR,
      view.request_id,
    );
    expect(
      listed.people.find((person) => person.person_id === second.person_id)
        ?.status,
    ).toBe('PENDING');
    expect(achievements.emitEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects a human decision without a reason and accepts an empty invest comment', async () => {
    const view = await present();
    await expect(
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { reject: [{ person_id: view.people[0].person_id, reason: '   ' }] },
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_REASON_REQUIRED,
    });
    expect(world.people[0].status).toBe('PENDING');

    const rejected = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      {
        reject: [
          { person_id: view.people[0].person_id, reason: 'Faltan evidencias' },
        ],
      },
      INSIDE,
    );
    expect(rejected.rejected_by_person[0]).toMatchObject({
      status: 'REJECTED_BY_PERSON',
      rejection_reason: null,
    });
    expect(world.people[0].rejection_reason).toBe('Faltan evidencias');
    const stored = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    expect(stored?.investiture_status).toBe('IN_PROGRESS');
    expect(achievements.emitEvent).not.toHaveBeenCalled();
  });

  it('system-rejects only the person who no longer qualifies', async () => {
    world.addMember('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    const view = await present([901, 902]);
    eligibility.calculateForEnrollment.mockImplementation(
      async (id: number) => ({
        investiture_eligibility: { eligible: id !== 901 },
      }),
    );

    const resolved = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      {
        invest: view.people.map((person) => ({ person_id: person.person_id })),
      },
      INSIDE,
    );

    expect(resolved.rejected_by_system).toHaveLength(1);
    expect(resolved.rejected_by_system[0].system_reason).toBe(
      INVESTITURE_SYSTEM_REJECTION_TEXT,
    );
    expect(resolved.invested).toHaveLength(1);
    const blocked = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    const invested = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 902 },
    });
    expect(blocked?.investiture_status).toBe('IN_PROGRESS');
    expect(invested?.investiture_status).toBe('INVESTIDO');
    expect(achievements.emitEvent).toHaveBeenCalledTimes(1);
  });

  it('does not authorize outside the window or after the year, and a date change does not reopen it', async () => {
    const view = await present();
    const personId = view.people[0].person_id;
    world.setWindow('2026-10-01', '2026-10-31');
    const outside = new Date('2026-11-15T18:00:00.000Z');

    await expect(
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        outside,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
    });

    await service.changeDates(
      director(),
      ACTOR,
      view.request_id,
      '2026-10-15',
      [personId],
      outside,
    );
    await expect(
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        outside,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
    });

    world.setWindow('2026-10-01', '2026-12-20');
    const opened = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: personId }] },
      outside,
    );
    expect(opened.invested).toHaveLength(1);

    world.addEnrollment({ enrollment_id: 903, class_id: 9 });
    const later = await present([903]);
    world.year.active = false;
    await expect(
      service.resolve(
        fieldDirector(),
        ACTOR,
        later.request_id,
        { invest: [{ person_id: later.people[0].person_id }] },
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
    world.year.active = true;
    await expect(
      service.resolve(
        fieldDirector(),
        ACTOR,
        later.request_id,
        { invest: [{ person_id: later.people[0].person_id }] },
        new Date('2027-01-02T18:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
  });

  it('blocks a person whose date fell outside the window and invests the rest', async () => {
    world.addMember('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    const view = await present([901, 902]);
    world.setWindow('2026-12-01', '2026-12-20');
    const today = new Date('2026-12-10T18:00:00.000Z');
    await service.changeDates(
      director(),
      ACTOR,
      view.request_id,
      '2026-12-10',
      [view.people[1].person_id],
      today,
    );

    const resolved = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      {
        invest: view.people.map((person) => ({ person_id: person.person_id })),
      },
      today,
    );

    expect(resolved.blocked).toEqual([
      {
        person_id: view.people[0].person_id,
        code: ErrorCode.INVESTITURE_REQUEST_DATE_OUTSIDE_WINDOW,
      },
    ]);
    expect(resolved.invested).toHaveLength(1);
    expect(world.people[0].status).toBe('PENDING');
  });

  it('keeps the first confirmed decision when authorize and reject race', async () => {
    const view = await present();
    const personId = view.people[0].person_id;
    const results = await Promise.allSettled([
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        INSIDE,
      ),
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { reject: [{ person_id: personId, reason: 'No cumple' }] },
        INSIDE,
      ),
    ]);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(
      rejected[0].status === 'rejected' && rejected[0].reason,
    ).toMatchObject({ code: ErrorCode.INVESTITURE_REQUEST_ALREADY_RESOLVED });
    const stored = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    if (world.people[0].status === 'INVESTED') {
      expect(stored?.investiture_status).toBe('INVESTIDO');
      expect(achievements.emitEvent.mock.calls.length).toBeGreaterThan(0);
      expect(
        achievements.emitEvent.mock.calls.every(
          (call) =>
            call[0].idempotencyKey === `investiture-authorization:${personId}`,
        ),
      ).toBe(true);
    } else {
      expect(world.people[0].status).toBe('REJECTED_BY_PERSON');
      expect(stored?.investiture_status).toBe('IN_PROGRESS');
      expect(achievements.emitEvent).not.toHaveBeenCalled();
    }
  });

  it('does not invest a person removed or closed while the decision waits', async () => {
    const view = await present();
    const personId = view.people[0].person_id;
    const results = await Promise.allSettled([
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: personId }] },
        INSIDE,
      ),
      service.remove(director(), ACTOR, view.request_id, personId, INSIDE),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect([
          ErrorCode.INVESTITURE_REQUEST_ALREADY_RESOLVED,
          ErrorCode.INVESTITURE_REQUEST_NOT_PENDING,
        ]).toContain(result.reason.code);
      }
    }
    const stored = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    if (world.people[0].status === 'INVESTED') {
      expect(stored?.investiture_status).toBe('INVESTIDO');
    } else {
      expect(world.people[0].status).toBe('REMOVED');
      expect(stored?.investiture_status).toBe('IN_PROGRESS');
      expect(achievements.emitEvent).not.toHaveBeenCalled();
    }

    const again = await present();
    const closing = await Promise.allSettled([
      service.resolve(
        fieldDirector(),
        ACTOR,
        again.request_id,
        { invest: [{ person_id: again.people[0].person_id }] },
        INSIDE,
      ),
      world.prisma.$transaction((tx) =>
        closePendingInvestitureAuthorizations(tx as never, {
          request_id: again.request_id,
        }),
      ),
    ]);
    const person = world.people.find(
      (row) => row.person_id === again.people[0].person_id,
    );
    const enrollment = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    if (person?.status === 'INVESTED') {
      expect(enrollment?.investiture_status).toBe('INVESTIDO');
      expect(
        closing.some(
          (result) => result.status === 'fulfilled' && result.value === 0,
        ),
      ).toBe(true);
    } else {
      expect(person?.status).toBe('CLOSED_YEAR');
      expect(enrollment?.investiture_status).toBe('IN_PROGRESS');
      expect(
        closing.some(
          (result) =>
            result.status === 'rejected' &&
            result.reason.code ===
              ErrorCode.INVESTITURE_REQUEST_ALREADY_RESOLVED,
        ),
      ).toBe(true);
    }
  });

  it('leaves the person and the enrollment pending when eligibility fails before confirm', async () => {
    const view = await present();
    eligibility.calculateForEnrollment.mockRejectedValueOnce(new Error('boom'));

    await expect(
      service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: view.people[0].person_id }] },
        INSIDE,
      ),
    ).rejects.toThrow('boom');
    expect(world.people[0].status).toBe('PENDING');
    const stored = await world.prisma.enrollments.findUnique({
      where: { enrollment_id: 901 },
    });
    expect(stored?.investiture_status).toBe('IN_PROGRESS');
    expect(achievements.emitEvent).not.toHaveBeenCalled();
  });

  it('does not emit class.completed when presenting', async () => {
    await present();
    expect(achievements.emitEvent).not.toHaveBeenCalled();
  });

  it('records the confirmed group once and does not mail a removal', async () => {
    const communications = {
      stagePresentation: jest.fn(async () => undefined),
      stageResults: jest.fn(async () => undefined),
      recordPresentation: jest.fn(async () => undefined),
      recordResults: jest.fn(async () => undefined),
      dispatchReminders: jest.fn(async () => 0),
      deliverPending: jest.fn(async () => 0),
    };
    const hooked = new InvestitureAuthorizationRequestService(
      world.prisma as never,
      eligibility as never,
      achievements as never,
      undefined,
      communications as never,
    );
    world.addEnrollment({
      enrollment_id: 902,
      class_id: 8,
      user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    world.addMember('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    const view = await hooked.present(
      director(),
      ACTOR,
      SECTION_ID,
      YEAR_ID,
      DATE,
      [901],
      INSIDE,
    );
    await hooked.addPeople(
      director(),
      ACTOR,
      view.request_id,
      DATE,
      [902],
      INSIDE,
    );
    await hooked.remove(
      director(),
      ACTOR,
      view.request_id,
      view.people[0].person_id,
      INSIDE,
    );

    const firstStage = communications.stagePresentation.mock.calls[0][1] as {
      requestId: string;
      enrollmentIds: number[];
      operationId: string;
    };
    const secondStage = communications.stagePresentation.mock.calls[1][1] as {
      operationId: string;
      enrollmentIds: number[];
    };
    expect(firstStage).toMatchObject({
      requestId: view.request_id,
      enrollmentIds: [901],
    });
    expect(firstStage.operationId).toEqual(expect.any(String));
    expect(secondStage.enrollmentIds).toEqual([902]);
    expect(secondStage.operationId).not.toEqual(firstStage.operationId);
    expect(
      communications.stagePresentation.mock.invocationCallOrder[0],
    ).toBeLessThan(
      communications.recordPresentation.mock.invocationCallOrder[0],
    );
    expect(communications.recordPresentation).toHaveBeenNthCalledWith(1, {
      requestId: view.request_id,
      enrollmentIds: [901],
      operationId: firstStage.operationId,
    });
    expect(communications.recordPresentation).toHaveBeenNthCalledWith(2, {
      requestId: view.request_id,
      enrollmentIds: [902],
      operationId: secondStage.operationId,
    });
    expect(communications.recordPresentation).toHaveBeenCalledTimes(2);
    expect(communications.recordResults).not.toHaveBeenCalled();
  });

  it('records a confirmed resolution and not the retry of that decision', async () => {
    const communications = {
      stagePresentation: jest.fn(async () => undefined),
      stageResults: jest.fn(async () => undefined),
      recordPresentation: jest.fn(async () => undefined),
      recordResults: jest.fn(async () => undefined),
      dispatchReminders: jest.fn(async () => 0),
      deliverPending: jest.fn(async () => 0),
    };
    const hooked = new InvestitureAuthorizationRequestService(
      world.prisma as never,
      eligibility as never,
      achievements as never,
      undefined,
      communications as never,
    );
    const view = await hooked.present(
      director(),
      ACTOR,
      SECTION_ID,
      YEAR_ID,
      DATE,
      [901],
      INSIDE,
    );
    await hooked.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      { invest: [{ person_id: view.people[0].person_id, comment: 'privado' }] },
      INSIDE,
    );
    await expect(
      hooked.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        { invest: [{ person_id: view.people[0].person_id }] },
        INSIDE,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_ALREADY_RESOLVED,
    });

    expect(communications.stageResults).toHaveBeenCalledTimes(1);
    expect(
      communications.stageResults.mock.invocationCallOrder[0],
    ).toBeLessThan(communications.recordResults.mock.invocationCallOrder[0]);
    expect(communications.recordResults).toHaveBeenCalledTimes(1);
    expect(communications.recordResults).toHaveBeenCalledWith({
      requestId: view.request_id,
      actorId: ACTOR,
      investedIds: [view.people[0].person_id],
      rejectedPersonIds: [],
      rejectedSystemIds: [],
    });
  });

  it('BC-2 accepts a blank or spaced zone and rejects an invalid one', async () => {
    world.section.clubs.local_fields.timezone = '   ';
    await expect(present()).resolves.toMatchObject({
      people: [expect.objectContaining({ user_id: USER })],
    });
  });

  it('BC-2 accepts a timezone surrounded by spaces', async () => {
    world.section.clubs.local_fields.timezone = '  America/Mexico_City  ';
    await expect(present()).resolves.toMatchObject({
      people: [expect.objectContaining({ class_id: 7 })],
    });
  });

  it('BC-2 rejects an invalid timezone with the same controlled error', async () => {
    world.section.clubs.local_fields.timezone = 'Not/AZone';
    await expect(present()).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_TIME_ZONE_INVALID,
    });
  });

  it('BC-4 names people for the board and hides the human reason from the authorizer', async () => {
    const prisma = world.prisma as typeof world.prisma & {
      users: { findMany: () => Promise<unknown[]> };
      classes: { findMany: () => Promise<unknown[]> };
    };
    prisma.users = {
      findMany: async () => [
        {
          user_id: USER,
          name: 'Ana',
          paternal_last_name: 'Ruiz',
          maternal_last_name: null,
        },
        {
          user_id: ACTOR,
          name: 'Pastor',
          paternal_last_name: 'Luis',
          maternal_last_name: null,
        },
      ],
    };
    prisma.classes = {
      findMany: async () => [{ class_id: 7, name: 'Amigo' }],
    };
    (world.section as { club_types?: { name: string } }).club_types = {
      name: 'Conquistadores',
    };
    const view = await present();
    expect(view.people[0]).toMatchObject({
      user_name: 'Ana Ruiz',
      class_name: 'Amigo',
      section_name: 'Conquistadores',
    });
    world.assignPastor();
    const decided = await service.resolve(
      fieldDirector(),
      ACTOR,
      view.request_id,
      {
        reject: [
          { person_id: view.people[0].person_id, reason: 'motivo-humano' },
        ],
      },
      INSIDE,
    );
    expect(decided.rejected_by_person[0].rejection_reason).toBeNull();
    expect(world.people[0].rejection_reason).toBe('motivo-humano');
    const boardHistory = await service.sectionHistory(director(), SECTION_ID);
    expect(boardHistory[0]).toMatchObject({
      rejection_reason: 'motivo-humano',
      status: 'REJECTED_BY_PERSON',
    });
    const authorizer = await service.readForAuthorizer(
      fieldDirector(),
      ACTOR,
      view.request_id,
    );
    expect(authorizer.people[0]).toMatchObject({
      user_name: 'Ana Ruiz',
      class_name: 'Amigo',
      rejection_reason: null,
    });
    world.people[0].status = 'REJECTED_BY_SYSTEM';
    world.people[0].system_reason = 'texto largo del sistema';
    world.people[0].resolved_by_id = null;
    const systemView = await service.readForAuthorizer(
      fieldDirector(),
      ACTOR,
      view.request_id,
    );
    expect(systemView.people[0]).toMatchObject({
      resolved_by_name: 'Sistema',
      system_reason: 'texto largo del sistema',
      rejection_reason: null,
    });
  });

  it('BC-5 lets super-admin read the request and forbids present and resolve', async () => {
    const view = await present();
    const root = {
      grants: {
        global_roles: [
          { role_name: 'super-admin', permissions: [], scope: {} },
        ],
        club_assignments: [],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: { permissions: [], scope: { global: {}, club: null } },
    } as AuthorizationSnapshot;
    const read = await service.readForAuthorizer(
      root,
      'root-1',
      view.request_id,
    );
    expect(read.people[0].person_id).toBe(view.people[0].person_id);
    await expect(
      service.present(root, 'root-1', SECTION_ID, YEAR_ID, DATE, [901], INSIDE),
    ).rejects.toMatchObject({ code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN });
    await expect(
      service.resolve(
        root,
        'root-1',
        view.request_id,
        { invest: [{ person_id: view.people[0].person_id }] },
        INSIDE,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN });
  });

  describe('BCR-1, BCR-7 and BCR-8 read paths', () => {
    function rootSnapshot(): AuthorizationSnapshot {
      return {
        grants: {
          global_roles: [
            { role_name: 'super-admin', permissions: [], scope: {} },
          ],
          club_assignments: [],
          direct_permissions: [],
        },
        active_assignment: { assignment_id: null },
        effective: { permissions: [], scope: { global: {}, club: null } },
      };
    }

    async function rejectedByHuman() {
      const view = await present();
      world.assignPastor();
      await service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        {
          reject: [
            { person_id: view.people[0].person_id, reason: 'motivo-humano' },
          ],
        },
        INSIDE,
      );
      return view;
    }

    it('BCR-1 resolves section_name from the club type for board and authorizer reads', async () => {
      const view = await present();
      expect(view.people[0].section_name).toBe('Conquistadores');
      world.assignPastor();
      const read = await service.readForAuthorizer(
        fieldDirector(),
        ACTOR,
        view.request_id,
      );
      expect(read.people[0].section_name).toBe('Conquistadores');
      const lookup = world.prisma.club_sections.findMany.mock.calls
        .map(
          ([args]) =>
            args as {
              select?: { club_types?: unknown };
              include?: { club_types?: unknown };
            },
        )
        .filter((args) => args.select?.club_types ?? args.include?.club_types);
      expect(lookup.length).toBeGreaterThan(0);
    });

    it('BCR-7 gives super-admin the authorizer shape without the human reason', async () => {
      const view = await rejectedByHuman();
      expect(world.people[0].rejection_reason).toBe('motivo-humano');
      const read = await service.readForAuthorizer(
        rootSnapshot(),
        'root-1',
        view.request_id,
      );
      expect(read.people[0]).toMatchObject({
        status: 'REJECTED_BY_PERSON',
        rejection_reason: null,
      });
      expect(JSON.stringify(read)).not.toContain('motivo-humano');
    });

    async function twoPeopleOneRejectedByHuman() {
      world.addEnrollment({
        enrollment_id: 902,
        class_id: 8,
        user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      });
      world.addMember('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
      const view = await present([901, 902]);
      world.assignPastor();
      await service.resolve(
        fieldDirector(),
        ACTOR,
        view.request_id,
        {
          reject: [
            { person_id: view.people[0].person_id, reason: 'motivo-humano' },
          ],
        },
        INSIDE,
      );
      return view;
    }

    it('BCR33-N1 changeDates by super-admin returns the authorizer shape without the human reason', async () => {
      const view = await twoPeopleOneRejectedByHuman();
      expect(world.people[0].rejection_reason).toBe('motivo-humano');
      const changed = await service.changeDates(
        rootSnapshot(),
        'root-1',
        view.request_id,
        '2026-11-20',
        [view.people[1].person_id],
        INSIDE,
      );
      expect(changed.people.map((p) => p.status)).toContain(
        'REJECTED_BY_PERSON',
      );
      expect(JSON.stringify(changed)).not.toContain('motivo-humano');
      expect(
        changed.people.find((p) => p.person_id === view.people[0].person_id),
      ).toMatchObject({ rejection_reason: null });
    });

    it('BCR33-N1 changeDates by the section directiva keeps the board shape with the human reason', async () => {
      const view = await twoPeopleOneRejectedByHuman();
      const changed = await service.changeDates(
        director(),
        ACTOR,
        view.request_id,
        '2026-11-20',
        [view.people[1].person_id],
        INSIDE,
      );
      expect(
        changed.people.find((p) => p.person_id === view.people[0].person_id),
      ).toMatchObject({ rejection_reason: 'motivo-humano' });
    });

    it('BCR-8 reads with an invalid stored zone for authorizer and super-admin', async () => {
      const view = await present();
      world.assignPastor();
      world.section.clubs.local_fields.timezone = 'Not/AZone';
      const asAuthorizer = await service.readForAuthorizer(
        fieldDirector(),
        ACTOR,
        view.request_id,
      );
      expect(asAuthorizer.people[0].person_id).toBe(view.people[0].person_id);
      const asRoot = await service.readForAuthorizer(
        rootSnapshot(),
        'root-1',
        view.request_id,
      );
      expect(asRoot.people[0].person_id).toBe(view.people[0].person_id);
    });

    it('BCR-8 keeps rejecting present and resolve with an invalid stored zone', async () => {
      const view = await present();
      world.assignPastor();
      world.section.clubs.local_fields.timezone = 'Not/AZone';
      await expect(present()).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_TIME_ZONE_INVALID,
      });
      await expect(
        service.resolve(
          fieldDirector(),
          ACTOR,
          view.request_id,
          { invest: [{ person_id: view.people[0].person_id }] },
          INSIDE,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_TIME_ZONE_INVALID,
      });
    });

    it('BCR-8 still denies a non-authorizer on a read with an invalid zone', async () => {
      const view = await present();
      world.section.clubs.local_fields.timezone = 'Not/AZone';
      await expect(
        service.readForAuthorizer(director(), ACTOR, view.request_id),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
      });
    });
  });

  describe('evaluateEnrollmentForPresentation', () => {
    async function evaluate(enrollmentId = 901) {
      const context = await service['loadContext'](SECTION_ID, YEAR_ID);
      const enrollment = await service['loadEnrollment'](enrollmentId);
      return service['evaluateEnrollmentForPresentation'](
        world.prisma as never,
        context,
        enrollment,
      );
    }

    const blocked: Array<[string, () => number]> = [
      [
        'INVESTITURE_REQUEST_NOT_OPERATIONAL',
        () => {
          world.addEnrollment({
            enrollment_id: 950,
            record_kind: 'HISTORICAL_CERTIFICATE',
          });
          return 950;
        },
      ],
      [
        'INVESTITURE_REQUEST_OUTSIDE_SECTION',
        () => {
          world.clearMembers();
          return 901;
        },
      ],
      [
        'INVESTITURE_REQUEST_CLASS_NOT_ELIGIBLE',
        () => {
          world.addEnrollment({
            enrollment_id: 951,
            classes: {
              min_duration_years: 1,
              max_duration_years: 1,
              club_type_id: 1,
              club_types: { name: 'Conquistadores' },
              asset_code: 'GM-02',
            },
          });
          return 951;
        },
      ],
      [
        'INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE',
        () => {
          const row = world.addEnrollment({ enrollment_id: 952, class_id: 9 });
          row.investiture_status = 'FIELD_APPROVED';
          row.locked_for_validation = true;
          return 952;
        },
      ],
      [
        'INVESTITURE_REQUEST_ALREADY_INVESTED',
        () => {
          const row = world.addEnrollment({ enrollment_id: 953, class_id: 10 });
          row.investiture_status = 'INVESTIDO';
          return 953;
        },
      ],
      [
        'INVESTITURE_REQUEST_ACTIVE_EXISTS',
        () => {
          world.people.push({
            person_id: '33333333-3333-4333-8333-333333333333',
            request_id: '44444444-4444-4444-8444-444444444444',
            user_id: USER,
            class_id: 7,
            enrollment_id: 901,
            investiture_date: new Date(`${DATE}T00:00:00.000Z`),
            status: 'PENDING',
            single_slot: true,
            resolution_code: null,
            resolved_by_id: null,
          });
          return 901;
        },
      ],
      [
        'INVESTITURE_REQUEST_NOT_ELIGIBLE',
        () => {
          eligibility.calculateForEnrollment.mockResolvedValueOnce({
            investiture_eligibility: { eligible: false },
          });
          return 901;
        },
      ],
      [
        'INVESTITURE_DURATION_MIN_NOT_MET',
        () => {
          world.addEnrollment({
            enrollment_id: 954,
            class_id: 11,
            classes: {
              min_duration_years: 3,
              max_duration_years: 3,
              club_type_id: 1,
              club_types: { name: 'Conquistadores' },
            },
          });
          world.setYearCount(1);
          return 954;
        },
      ],
      [
        'INVESTITURE_DURATION_EXPIRED',
        () => {
          world.setYearCount(4);
          return 901;
        },
      ],
    ];

    it.each(blocked)('returns %s without writing', async (code, arrange) => {
      const enrollmentId = arrange();

      await expect(evaluate(enrollmentId)).resolves.toEqual({
        eligible: false,
        code: ErrorCode[code as keyof typeof ErrorCode],
      });

      expect(
        world.prisma.investiture_authorization_people.create,
      ).not.toHaveBeenCalled();
      expect(
        world.prisma.investiture_authorization_people.update,
      ).not.toHaveBeenCalled();
      expect(
        world.prisma.investiture_authorization_people.updateMany,
      ).not.toHaveBeenCalled();
    });

    it('returns EXPIRED status as a duration expiry', async () => {
      world.addEnrollment({
        enrollment_id: 955,
        class_id: 12,
        investiture_status: 'EXPIRED',
      });

      await expect(evaluate(955)).resolves.toEqual({
        eligible: false,
        code: ErrorCode.INVESTITURE_DURATION_EXPIRED,
      });
    });

    it('returns eligible with the single-slot flag for a clean enrollment', async () => {
      await expect(evaluate()).resolves.toEqual({
        eligible: true,
        singleSlot: true,
      });
      expect(
        world.prisma.investiture_authorization_people.create,
      ).not.toHaveBeenCalled();
    });
  });

  describe('authorizer reads carry club, section and counts', () => {
    const SOUTH_USER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

    async function twoClubs() {
      world.addSection({
        club_section_id: 8,
        club_type_id: 1,
        main_club_id: 2,
        club_types: { name: 'Conquistadores' },
        clubs: {
          club_id: 2,
          name: 'Club Sur',
          local_field_id: 10,
          local_fields: { timezone: 'America/Mexico_City' },
          churches: {
            districlub_type_id: 3,
            districts: { name: 'Distrito Este' },
          },
        },
      });
      world.addMember(SOUTH_USER, 8);
      world.addEnrollment({
        enrollment_id: 960,
        user_id: SOUTH_USER,
        class_id: 9,
      });
      const north = await present([901], '2026-11-20');
      const south = await present(
        [960],
        '2026-11-05',
        INSIDE,
        director('director', 8),
        8,
      );
      return { north, south };
    }

    it('lists club, section, district, pending count and the earliest date for each request', async () => {
      const { north, south } = await twoClubs();
      world.assignPastor();

      const listed = await service.listForAuthorizer(
        fieldDirector(),
        ACTOR,
        YEAR_ID,
      );

      const byId = new Map(listed.map((view) => [view.request_id, view]));
      expect(byId.get(north.request_id)).toMatchObject({
        club_section_id: SECTION_ID,
        club_id: 1,
        club_name: 'Club Norte',
        section_name: 'Conquistadores',
        district_name: 'Distrito Sur',
        pending_count: 1,
        earliest_investiture_date: '2026-11-20',
        created_at: '2026-10-01T12:00:00.000Z',
      });
      expect(byId.get(south.request_id)).toMatchObject({
        club_section_id: 8,
        club_id: 2,
        club_name: 'Club Sur',
        section_name: 'Conquistadores',
        district_name: 'Distrito Este',
        pending_count: 1,
        earliest_investiture_date: '2026-11-05',
      });
      expect(byId.get(north.request_id)?.people[0]).toEqual(north.people[0]);
    });

    it('counts only PENDING people and takes the earliest of those dates', async () => {
      const { north } = await twoClubs();
      world.addMember(OTHER_USER);
      world.addEnrollment({
        enrollment_id: 962,
        user_id: OTHER_USER,
        class_id: 11,
      });
      const added = await service.addPeople(
        director(),
        ACTOR,
        north.request_id,
        '2026-11-03',
        [962],
        INSIDE,
      );
      const early = added.people.find((p) => p.enrollment_id === 962);
      expect(early).toBeDefined();
      world.assignPastor();

      const read = await service.readForAuthorizer(
        fieldDirector(),
        ACTOR,
        north.request_id,
      );
      expect(read).toMatchObject({
        pending_count: 2,
        earliest_investiture_date: '2026-11-03',
      });

      const row = world.people.find((p) => p.person_id === early?.person_id);
      if (row) {
        row.status = 'REMOVED';
      }
      const afterRemoval = await service.readForAuthorizer(
        fieldDirector(),
        ACTOR,
        north.request_id,
      );
      expect(afterRemoval).toMatchObject({
        pending_count: 1,
        earliest_investiture_date: '2026-11-20',
      });
    });

    it('returns the same header on the detail read and null date without pending', async () => {
      const view = await present();
      world.assignPastor();
      const detail = await service.readForAuthorizer(
        fieldDirector(),
        ACTOR,
        view.request_id,
      );
      expect(detail).toMatchObject({
        club_id: 1,
        club_name: 'Club Norte',
        section_name: 'Conquistadores',
        district_name: 'Distrito Sur',
        pending_count: 1,
        earliest_investiture_date: DATE,
        created_at: '2026-10-01T12:00:00.000Z',
      });

      world.people[0].status = 'INVESTED';
      const resolved = await service.readForAuthorizer(
        fieldDirector(),
        ACTOR,
        view.request_id,
      );
      expect(resolved).toMatchObject({
        pending_count: 0,
        earliest_investiture_date: null,
      });
    });

    it('reads the list in batch without per-request lookups', async () => {
      await twoClubs();
      world.assignPastor();
      world.prisma.investiture_authorization_requests.findUnique.mockClear();
      world.prisma.club_sections.findUnique.mockClear();
      world.prisma.users.findMany.mockClear();
      world.prisma.club_sections.findMany.mockClear();

      const listed = await service.listForAuthorizer(
        fieldDirector(),
        ACTOR,
        YEAR_ID,
      );

      expect(listed).toHaveLength(2);
      expect(
        world.prisma.investiture_authorization_requests.findUnique,
      ).not.toHaveBeenCalled();
      expect(world.prisma.club_sections.findUnique).not.toHaveBeenCalled();
      expect(world.prisma.users.findMany).toHaveBeenCalledTimes(1);
      const labelLookups =
        world.prisma.club_sections.findMany.mock.calls.filter(([args]) =>
          Boolean(
            (args as { where?: { club_section_id?: unknown } }).where
              ?.club_section_id,
          ),
        );
      expect(labelLookups).toHaveLength(1);
    });
  });

  describe('presentationContext', () => {
    const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    function context(authorization = director(), now = INSIDE) {
      return service.presentationContext(
        authorization,
        SECTION_ID,
        YEAR_ID,
        now,
      );
    }

    function stubNoWrites() {
      return jest.spyOn(world.prisma, '$transaction');
    }

    it('lists an eligible member and a PENDING one with its blocked code', async () => {
      world.setUserName(USER, 'Ana');
      world.setUserName(OTHER, 'Beto');
      world.addMember(OTHER);
      world.addEnrollment({ enrollment_id: 902, user_id: OTHER, class_id: 8 });
      const opened = await present([902]);

      const view = await context();

      expect(view.open_request_id).toBe(opened.request_id);
      expect(view.club_section_id).toBe(SECTION_ID);
      expect(view.ecclesiastical_year_id).toBe(YEAR_ID);
      expect(view.candidates).toEqual([
        expect.objectContaining({
          enrollment_id: 901,
          user_id: USER,
          user_name: 'Ana',
          class_id: 7,
          overall_progress: 80,
          eligible: true,
          blocked_code: null,
          pending_person_id: null,
        }),
        expect.objectContaining({
          enrollment_id: 902,
          user_id: OTHER,
          user_name: 'Beto',
          eligible: false,
          blocked_code: 'INVESTITURE_REQUEST_ACTIVE_EXISTS',
          pending_person_id: opened.people[0].person_id,
        }),
      ]);
    });

    it('reports the window and still lists candidates when it is closed today', async () => {
      const view = await context(director(), OUTSIDE);

      expect(view.year_open).toBe(true);
      expect(view.window.open_today).toBe(false);
      expect(view.window.start_date).toEqual(expect.any(String));
      expect(view.window.end_date).toEqual(expect.any(String));
      expect(view.open_request_id).toBeNull();
      expect(view.candidates).toHaveLength(1);
      expect((await context()).window.open_today).toBe(true);
    });

    it('R2 reports an invalid Field time zone instead of a window open today', async () => {
      expect((await context()).window).toMatchObject({
        open_today: true,
        time_zone_invalid: false,
      });
      world.section.clubs.local_fields.timezone = 'Mars/Olympus';

      const view = await context();

      expect(view.window.open_today).toBe(false);
      expect(view.window.time_zone_invalid).toBe(true);
      expect(view.window.start_date).toEqual(expect.any(String));
      expect(view.candidates).toHaveLength(1);
      await expect(present()).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_TIME_ZONE_INVALID,
      });
    });

    it('reports year_open false once the year ended', async () => {
      world.year.active = false;

      const view = await context(director(), new Date('2027-01-02T18:00:00Z'));

      expect(view.year_open).toBe(false);
    });

    it('forbids the subdirector, a non-member and super-admin without a role', async () => {
      await expect(context(director('subdirector'))).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
      });
      await expect(
        context(director('director', SECTION_ID + 1)),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
      });
      await expect(
        context(snapshot([], ['super-admin'])),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REQUEST_FORBIDDEN,
      });
      expect(eligibility.calculateForEnrollments).not.toHaveBeenCalled();
    });

    it('allows secretary and secretary-treasurer', async () => {
      await expect(context(director('secretary'))).resolves.toBeDefined();
      await expect(
        context(director('secretary-treasurer')),
      ).resolves.toBeDefined();
    });

    it('never writes and takes no lock', async () => {
      const transaction = stubNoWrites();
      await present();
      transaction.mockClear();
      world.prisma.$executeRaw.mockClear();
      for (const delegate of [
        world.prisma.investiture_authorization_people,
        world.prisma.investiture_authorization_requests,
        world.prisma.enrollments,
      ]) {
        for (const method of ['create', 'update', 'updateMany'] as const) {
          const fn = (delegate as Record<string, jest.Mock | undefined>)[
            method
          ];
          fn?.mockClear();
        }
      }

      await context();

      expect(transaction).not.toHaveBeenCalled();
      expect(world.prisma.$executeRaw).not.toHaveBeenCalled();
      expect(
        world.prisma.investiture_authorization_people.create,
      ).not.toHaveBeenCalled();
      expect(
        world.prisma.investiture_authorization_people.update,
      ).not.toHaveBeenCalled();
      expect(
        world.prisma.investiture_authorization_people.updateMany,
      ).not.toHaveBeenCalled();
      expect(
        world.prisma.investiture_authorization_requests.create,
      ).not.toHaveBeenCalled();
      expect(world.prisma.enrollments.update).not.toHaveBeenCalled();
      expect(world.prisma.enrollments.updateMany).not.toHaveBeenCalled();
    });

    it('computes progress once in batch and not per candidate', async () => {
      world.addMember(OTHER);
      world.addEnrollment({ enrollment_id: 902, user_id: OTHER, class_id: 8 });

      await context();

      expect(eligibility.calculateForEnrollments).toHaveBeenCalledTimes(1);
      expect(eligibility.calculateForEnrollments).toHaveBeenCalledWith([
        901, 902,
      ]);
      expect(eligibility.calculateForEnrollment).not.toHaveBeenCalled();
    });

    it('orders eligible first and then by name', async () => {
      world.setUserName(USER, 'Zoe');
      world.setUserName(OTHER, 'Ana');
      world.addMember(OTHER);
      world.addEnrollment({
        enrollment_id: 902,
        user_id: OTHER,
        class_id: 8,
        investiture_status: 'FIELD_APPROVED',
        locked_for_validation: true,
      });
      const third = 'cccccccc-cccc-4ccc-8ccc-ccccccccc111';
      world.addMember(third);
      world.setUserName(third, 'Mia');
      world.addEnrollment({ enrollment_id: 903, user_id: third, class_id: 9 });

      const view = await context();

      expect(view.candidates.map((row) => row.user_name)).toEqual([
        'Mia',
        'Zoe',
        'Ana',
      ]);
      expect(view.candidates[2]).toMatchObject({
        eligible: false,
        blocked_code: 'INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE',
      });
    });

    it('skips enrollments that are not operational, inactive, already invested or of another club type', async () => {
      world.addEnrollment({
        enrollment_id: 910,
        class_id: 21,
        record_kind: 'HISTORICAL_CERTIFICATE',
      });
      world.addEnrollment({ enrollment_id: 911, class_id: 22, active: false });
      world.addEnrollment({
        enrollment_id: 912,
        class_id: 23,
        investiture_status: 'INVESTIDO',
      });
      world.addEnrollment({
        enrollment_id: 913,
        class_id: 24,
        classes: {
          min_duration_years: 1,
          max_duration_years: 1,
          club_type_id: 2,
          club_types: { name: 'Aventureros' },
        },
      });

      const view = await context();

      expect(view.candidates.map((row) => row.enrollment_id)).toEqual([901]);
    });

    it('flags a sibling enrollment of an already invested class', async () => {
      world.addEnrollment({
        enrollment_id: 914,
        class_id: 7,
        investiture_status: 'INVESTIDO',
        ecclesiastical_year_id: 2025,
      });

      const view = await context();

      expect(view.candidates).toEqual([
        expect.objectContaining({
          enrollment_id: 901,
          eligible: false,
          blocked_code: 'INVESTITURE_REQUEST_ALREADY_INVESTED',
        }),
      ]);
    });

    it('R1 reads a constant number of queries however many candidates there are', async () => {
      const GM_CLASS = {
        min_duration_years: 1,
        max_duration_years: 1,
        club_type_id: 2,
        club_types: { name: 'Guías Mayores' },
      };
      function totalCalls(prisma: object): number {
        let total = 0;
        for (const [key, delegate] of Object.entries(prisma)) {
          if (key.startsWith('$') || typeof delegate !== 'object') {
            continue;
          }
          for (const method of Object.values(delegate ?? {})) {
            if (jest.isMockFunction(method)) {
              total += method.mock.calls.length;
            }
          }
        }
        return total;
      }
      async function callsFor(count: number): Promise<number> {
        const crowded = createWorld();
        crowded.addMember();
        crowded.addEnrollment({ enrollment_id: 901 });
        crowded.addSection({
          club_section_id: 8,
          club_type_id: 2,
          main_club_id: 1,
        });
        const bound = bind(crowded);
        for (let index = 0; index < count; index += 1) {
          const userId = `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, '0')}`;
          crowded.addMember(userId);
          crowded.addEnrollment({
            enrollment_id: 1000 + index,
            user_id: userId,
            class_id: 100 + index,
            ...(index % 4 === 0 ? { cross_type_enrollment: true } : {}),
          });
          if (index % 3 === 0) {
            crowded.addEnrollment({
              enrollment_id: 5000 + index,
              user_id: userId,
              class_id: 100 + index,
              investiture_status: 'INVESTIDO',
              ecclesiastical_year_id: 2025,
            });
          }
          if (index % 5 === 0) {
            const crossUser = `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`;
            crowded.addMember(crossUser, 8, {
              club_type_id: 2,
              main_club_id: 1,
            });
            crowded.addEnrollment({
              enrollment_id: 7000 + index,
              user_id: crossUser,
              class_id: 7,
              cross_type_enrollment: true,
            });
            crowded.addEnrollment({
              enrollment_id: 8000 + index,
              user_id: crossUser,
              class_id: 40,
              investiture_status: 'INVESTIDO',
              record_kind: 'HISTORICAL_CERTIFICATE',
              classes: GM_CLASS,
            });
          }
        }
        const before = totalCalls(crowded.prisma);
        const view = await bound.service.presentationContext(
          director(),
          SECTION_ID,
          YEAR_ID,
          INSIDE,
        );
        expect(view.candidates.length).toBeGreaterThanOrEqual(count);
        expect(bound.eligibility.calculateForEnrollment).not.toHaveBeenCalled();
        return totalCalls(crowded.prisma) - before;
      }

      const few = await callsFor(3);
      const many = await callsFor(40);

      expect(many).toBe(few);
      expect(many).toBeLessThanOrEqual(16);
    });

    it('R1 gives each candidate the same verdict the transactional present path gives', async () => {
      const blockedIds = new Set<number>();
      eligibility.calculateForEnrollment.mockImplementation(
        async (id: number) =>
          ({
            investiture_eligibility: { eligible: !blockedIds.has(id) },
          }) as never,
      );
      eligibility.calculateForEnrollments.mockImplementation(
        async (ids: number[]) =>
          new Map(
            ids.map((id) => [
              id,
              {
                investiture_eligibility: { eligible: !blockedIds.has(id) },
                overall_progress: 50,
              },
            ]),
          ) as never,
      );
      let seq = 0;
      const nextUser = () => {
        seq += 1;
        const user = `99999999-9999-4999-8999-${String(seq).padStart(12, '0')}`;
        world.addMember(user);
        return user;
      };
      const row = (overrides: Parameters<typeof world.addEnrollment>[0]) =>
        world.addEnrollment(overrides).enrollment_id;
      let next = 2000;
      const id = () => (next += 1);

      const fixtures: Record<string, number> = {};
      fixtures.eligible = row({ enrollment_id: id(), user_id: nextUser() });
      {
        const user = nextUser();
        row({
          enrollment_id: id(),
          user_id: user,
          class_id: 31,
          investiture_status: 'INVESTIDO',
          ecclesiastical_year_id: 2025,
        });
        fixtures.invested = row({
          enrollment_id: id(),
          user_id: user,
          class_id: 31,
        });
      }
      fixtures.legacy = row({
        enrollment_id: id(),
        user_id: nextUser(),
        investiture_status: 'FIELD_APPROVED',
        locked_for_validation: true,
      });
      {
        const user = nextUser();
        const first = row({
          enrollment_id: id(),
          user_id: user,
          class_id: 32,
        });
        await present([first]);
        fixtures.pending = row({
          enrollment_id: id(),
          user_id: user,
          class_id: 33,
        });
        fixtures.presented = first;
      }
      fixtures.notEligible = row({
        enrollment_id: id(),
        user_id: nextUser(),
        class_id: 34,
      });
      blockedIds.add(fixtures.notEligible);
      fixtures.minNotMet = row({
        enrollment_id: id(),
        user_id: nextUser(),
        class_id: 35,
        classes: {
          min_duration_years: 2,
          max_duration_years: 3,
          club_type_id: 1,
          club_types: { name: 'Conquistadores' },
        },
      });
      fixtures.overMax = row({
        enrollment_id: id(),
        user_id: nextUser(),
        class_id: 36,
        classes: {
          min_duration_years: 0,
          max_duration_years: 0,
          club_type_id: 1,
          club_types: { name: 'Conquistadores' },
        },
      });
      fixtures.expiredStatus = row({
        enrollment_id: id(),
        user_id: nextUser(),
        class_id: 37,
        investiture_status: 'EXPIRED',
      });
      world.addSection({
        club_section_id: 8,
        club_type_id: 2,
        main_club_id: 1,
      });
      const crossUser = 'dddddddd-dddd-4ddd-8ddd-ddddddddd333';
      world.addMember(crossUser, 8, { club_type_id: 2, main_club_id: 1 });
      fixtures.crossWithGm = row({
        enrollment_id: id(),
        user_id: crossUser,
        class_id: 38,
        cross_type_enrollment: true,
      });
      row({
        enrollment_id: id(),
        user_id: crossUser,
        class_id: 40,
        investiture_status: 'INVESTIDO',
        record_kind: 'HISTORICAL_CERTIFICATE',
        classes: {
          min_duration_years: 1,
          max_duration_years: 1,
          club_type_id: 2,
          club_types: { name: 'Guías Mayores' },
        },
      });
      const noGmUser = 'dddddddd-dddd-4ddd-8ddd-ddddddddd444';
      world.addMember(noGmUser, 8, { club_type_id: 2, main_club_id: 1 });
      const crossWithoutGm = row({
        enrollment_id: id(),
        user_id: noGmUser,
        class_id: 39,
        cross_type_enrollment: true,
      });

      const view = await context();
      const viaContext = new Map(
        view.candidates.map((candidate) => [
          candidate.enrollment_id,
          candidate.blocked_code,
        ]),
      );
      async function viaPresent(enrollmentId: number) {
        try {
          await present([enrollmentId]);
          return null;
        } catch (error) {
          return (error as { code: string }).code;
        }
      }

      expect(viaContext.has(crossWithoutGm)).toBe(false);
      expect(await viaPresent(crossWithoutGm)).toBe(
        ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION,
      );
      const seen = new Set<string | null>();
      for (const [name, enrollmentId] of Object.entries(fixtures)) {
        expect(viaContext.has(enrollmentId)).toBe(true);
        const fromContext = viaContext.get(enrollmentId) ?? null;
        expect({ name, code: await viaPresent(enrollmentId) }).toEqual({
          name,
          code: fromContext,
        });
        seen.add(fromContext);
      }
      expect([...seen].sort()).toEqual(
        [
          null,
          ErrorCode.INVESTITURE_REQUEST_ALREADY_INVESTED,
          ErrorCode.INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE,
          ErrorCode.INVESTITURE_REQUEST_ACTIVE_EXISTS,
          ErrorCode.INVESTITURE_REQUEST_NOT_ELIGIBLE,
          ErrorCode.INVESTITURE_DURATION_MIN_NOT_MET,
          ErrorCode.INVESTITURE_DURATION_EXPIRED,
        ].sort(),
      );
    });

    it.each(['GM-02', 'GM-03'] as const)(
      'R3 leaves the institutional class %s out of the candidates',
      async (assetCode) => {
        world.addEnrollment({
          enrollment_id: 960,
          class_id: 60,
          classes: institutionalClass(assetCode),
        });

        const view = await context();

        expect(view.candidates.map((row) => row.enrollment_id)).toEqual([901]);
        expect(eligibility.calculateForEnrollments).toHaveBeenCalledWith([901]);
        // present keeps refusing it with the same code (IA-62).
        await expect(present([960])).rejects.toMatchObject({
          code: ErrorCode.INVESTITURE_REQUEST_CLASS_NOT_ELIGIBLE,
        });
      },
    );

    it('R4 shares one membership filter between present and the candidate list', async () => {
      const scope = {
        clubSectionId: SECTION_ID,
        clubTypeId: 1,
        mainClubId: 1,
        yearId: YEAR_ID,
      };
      const assignments = world.prisma.club_role_assignments;
      const enrollmentsDelegate = world.prisma.enrollments;
      await present();
      const presentWhere = assignments.findFirst.mock.calls[0][0].where;
      expect(presentWhere).toEqual({
        user_id: USER,
        ...sectionMemberAssignmentWhere(scope),
      });

      enrollmentsDelegate.findMany.mockClear();
      assignments.findFirst.mockClear();
      await context();
      const filters = enrollmentsDelegate.findMany.mock.calls.map(
        ([args]) => args.where.users?.club_role_assignments?.some,
      );
      expect(filters).toContainEqual(sectionMemberAssignmentWhere(scope));
      expect(filters).toContainEqual(crossTypeHomeAssignmentWhere(scope));
    });

    it('includes a cross-type enrollment only when its home section and invested Guía Mayor hold', async () => {
      world.addSection({
        club_section_id: 8,
        club_type_id: 2,
        main_club_id: 1,
      });
      const crossUser = 'dddddddd-dddd-4ddd-8ddd-ddddddddd222';
      world.addMember(crossUser, 8, { club_type_id: 2, main_club_id: 1 });
      world.addEnrollment({
        enrollment_id: 920,
        user_id: crossUser,
        class_id: 7,
        cross_type_enrollment: true,
      });

      expect(
        (await context()).candidates.map((row) => row.enrollment_id),
      ).toEqual([901]);

      world.addEnrollment({
        enrollment_id: 921,
        user_id: crossUser,
        class_id: 40,
        investiture_status: 'INVESTIDO',
        record_kind: 'HISTORICAL_CERTIFICATE',
        classes: {
          min_duration_years: 1,
          max_duration_years: 1,
          club_type_id: 2,
          club_types: { name: 'Guías Mayores' },
        },
      });

      const view = await context();
      expect(view.candidates.map((row) => row.enrollment_id).sort()).toEqual([
        901, 920,
      ]);
      expect(
        view.candidates.find((row) => row.enrollment_id === 920),
      ).toMatchObject({ eligible: true, user_id: crossUser });
    });
  });

  it('BC-13 stores the actor and uses the injected clock', async () => {
    const at = new Date('2026-10-20T15:00:00.000Z');
    const timed = new InvestitureAuthorizationRequestService(
      world.prisma as never,
      eligibility as never,
      achievements as never,
      { now: () => at },
    );
    const view = await timed.present(
      director(),
      ACTOR,
      SECTION_ID,
      YEAR_ID,
      DATE,
      [901],
      INSIDE,
    );
    const changed = await timed.changeDates(
      director(),
      ACTOR,
      view.request_id,
      '2026-11-02',
      [view.people[0].person_id],
    );
    expect(changed.people[0]).toMatchObject({
      date_changed_by_id: ACTOR,
      date_changed_at: at.toISOString(),
    });
    const late = new InvestitureAuthorizationRequestService(
      world.prisma as never,
      eligibility as never,
      achievements as never,
      { now: () => new Date('2027-01-02T18:00:00.000Z') },
    );
    await expect(
      late.remove(director(), ACTOR, view.request_id, view.people[0].person_id),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED,
    });
  });
});
