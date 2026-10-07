import { ErrorCode } from '../common/errors/error-codes';
import type {
  AuthorizationSnapshot,
  ClubAuthorizationGrant,
} from '../common/services/authorization-context.service';
import {
  INVESTITURE_SYSTEM_REJECTION_TEXT,
  InvestitureAuthorizationRequestService,
} from './investiture-authorization-requests.service';

const SECTION_ID = 4;
const YEAR_ID = 2026;
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INSIDE = new Date('2026-10-15T18:00:00.000Z');
const OUTSIDE = new Date('2026-02-15T18:00:00.000Z');
const DATE = '2026-11-01';

type EnrollmentSeed = {
  enrollment_id: number;
  user_id: string;
  class_id: number;
  ecclesiastical_year_id: number;
  investiture_status: string;
  record_kind: string;
  cross_type_enrollment: boolean;
  active: boolean;
  classes: {
    min_duration_years: number;
    max_duration_years: number;
    club_type_id: number;
    club_types: { name: string } | null;
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
};

type RequestSeed = {
  request_id: string;
  club_section_id: number;
  ecclesiastical_year_id: number;
  created_by_id: string;
};

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
    clubs: {
      local_field_id: 10,
      local_fields: { timezone: 'America/Mexico_City' },
      churches: { districlub_type_id: 3 },
    },
  };
  let windowRow: { start_date: Date; end_date: Date } | null = null;
  let yearCount = 1;
  const pastors: Array<{
    user_id: string;
    districlub_type_id: number;
    active: boolean;
  }> = [];
  const sections = [section];
  let seq = 1;
  const held = new Map<string, symbol>();
  const queues = new Map<string, Array<() => void>>();
  let didPause = false;
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
      user_id?: string;
      class_id?: number;
      status?: string;
      request_id?: string;
      enrollment_id?: number | { in: number[] };
      request?: { club_section_id?: number; ecclesiastical_year_id?: number };
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
    if (where.user_id && row.user_id !== where.user_id) {
      return false;
    }
    if (where.class_id !== undefined && row.class_id !== where.class_id) {
      return false;
    }
    if (where.status && row.status !== where.status) {
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
    findFirst: jest.fn(async ({ where }: { where?: object }) => {
      return people.find((row) => matchesPerson(row, where ?? {})) ?? null;
    }),
    findMany: jest.fn(async ({ where }: { where?: object }) => {
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
      return matched;
    }),
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
          ...data,
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
      }: {
        where?: {
          ecclesiastical_year_id?: number;
          club_section_id?: { in: number[] };
          people?: { some?: { status?: string } };
        };
      }) => {
        return requests.filter((row) => {
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
          if (where?.people?.some?.status) {
            const status = where.people.some.status;
            const has = people.some(
              (person) =>
                person.request_id === row.request_id &&
                person.status === status,
            );
            if (!has) {
              return false;
            }
          }
          return true;
        });
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
          where: { user_id: string; investiture_status: string };
        }) => {
          return (
            enrollments.find(
              (row) =>
                row.user_id === where.user_id &&
                row.investiture_status === where.investiture_status &&
                row.classes?.club_types?.name === 'Guías Mayores',
            ) ?? null
          );
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
      findUnique: jest.fn(
        async ({ where }: { where: { club_section_id: number } }) => {
          return (
            sections.find(
              (row) => row.club_section_id === where.club_section_id,
            ) ?? null
          );
        },
      ),
    },
    ecclesiastical_years: {
      findUnique: jest.fn(async ({ where }: { where: { year_id: number } }) => {
        return where.year_id === year.year_id ? year : null;
      }),
      count: jest.fn(async () => yearCount),
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
    addSection(row: {
      club_section_id: number;
      club_type_id: number;
      main_club_id: number;
    }) {
      sections.push({
        club_section_id: row.club_section_id,
        club_type_id: row.club_type_id,
        active: true,
        main_club_id: row.main_club_id,
        clubs: section.clubs,
      });
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
    addEnrollment(overrides: Partial<EnrollmentSeed> = {}): EnrollmentSeed {
      const row: EnrollmentSeed = {
        enrollment_id: overrides.enrollment_id ?? enrollments.length + 901,
        user_id: USER,
        class_id: 7,
        ecclesiastical_year_id: YEAR_ID,
        investiture_status: 'IN_PROGRESS',
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
    expect(achievements.emitEvent).toHaveBeenCalledTimes(1);
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
      rejection_reason: 'Faltan evidencias',
    });
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
      expect(achievements.emitEvent).toHaveBeenCalledTimes(1);
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
      service.closePendingByYearEnd(again.people[0].person_id),
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
          (result) => result.status === 'fulfilled' && result.value === false,
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
});
