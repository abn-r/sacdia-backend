import { Logger } from '@nestjs/common';
import { EmailProcessor } from '../common/email/email.processor';
import { EMAIL_JOB_INVESTITURE_NOTICE } from '../common/email/email.queue';
import { InvestitureCommunicationsService } from './investiture-communications.service';
import { INVESTITURE_WINDOW_CLOSED_REMINDER } from './investiture-communications.rules';

const REQUEST = '99999999-9999-4999-8999-999999999999';
const PERSON = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRUNO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PASTOR = '11111111-1111-4111-8111-111111111111';
const OTHER_PASTOR = '22222222-2222-4222-8222-222222222222';
const DIRECTOR = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';

type DispatchRow = {
  dispatch_id: string;
  kind: string;
  execution_key: string;
  recipient_user_id: string;
  role: string;
  scope_key: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  lease_until: Date | null;
  claim_token: string | null;
  sent_at: Date | null;
  last_error: string | null;
};

export function world() {
  const dispatches: DispatchRow[] = [];
  const logs: Array<{
    log_id: number;
    title: string;
    body: string;
    source: string | null;
    idempotency_key: string | null;
    target_id: string | null;
  }> = [];
  const deliveries: Array<{ log_id: number; user_id: string }> = [];
  const state = {
    failRequestRead: false,
    failQueue: 0,
    pastorActive: true,
    yearActive: true,
    pending: true,
    window: null as { start_date: Date; end_date: Date } | null,
    failInbox: false,
    failSentAck: false,
    officerFieldId: 10,
    includeOfficer: true,
    extraPastor: true,
    personStatus: 'PENDING' as string,
    rejectionReason: 'motivo-humano-privado',
    deletedAccounts: new Set<string>(),
    rolelessUsers: new Set<string>(),
  };
  const person = () => ({
    person_id: PERSON,
    request_id: REQUEST,
    enrollment_id: 1,
    user_id: PERSON,
    class_id: 1,
    status: state.pending ? state.personStatus : 'INVESTED',
    investiture_date: new Date('2026-11-01T00:00:00.000Z'),
    authorization_comment: 'comentario-privado',
    rejection_reason: state.rejectionReason,
    system_reason: null,
  });
  const request = {
    request_id: REQUEST,
    club_section_id: 1,
    ecclesiastical_year_id: 1,
    created_at: new Date('2026-09-21T12:00:00.000Z'),
  };
  const section = {
    club_section_id: 1,
    club_types: { name: 'Conquistadores' },
    clubs: {
      local_field_id: 10,
      local_fields: { timezone: 'America/Mexico_City' },
      churches: { districlub_type_id: 4 },
    },
  };
  const matchesDispatch = (
    row: DispatchRow,
    where: Record<string, unknown>,
  ) => {
    if (where.dispatch_id && row.dispatch_id !== where.dispatch_id) {
      return false;
    }
    const unique = where.uq_investiture_message_dispatch as
      Record<string, string> | undefined;
    if (unique) {
      if (
        row.kind !== unique.kind ||
        row.execution_key !== unique.execution_key ||
        row.recipient_user_id !== unique.recipient_user_id ||
        row.role !== unique.role ||
        row.scope_key !== unique.scope_key
      ) {
        return false;
      }
    }
    const kind = where.kind as { in?: string[] } | string | undefined;
    if (kind && typeof kind === 'object') {
      if (kind.in && !kind.in.includes(row.kind)) {
        return false;
      }
    } else if (kind && row.kind !== kind) {
      return false;
    }
    if (where.execution_key && row.execution_key !== where.execution_key) {
      return false;
    }
    if (
      where.recipient_user_id &&
      row.recipient_user_id !== where.recipient_user_id
    ) {
      return false;
    }
    if (where.role && row.role !== where.role) {
      return false;
    }
    if (where.scope_key && row.scope_key !== where.scope_key) {
      return false;
    }
    if (where.claim_token && row.claim_token !== where.claim_token) {
      return false;
    }
    const status = where.status as { in?: string[] } | string | undefined;
    if (typeof status === 'string' && row.status !== status) {
      return false;
    }
    if (
      status &&
      typeof status === 'object' &&
      status.in &&
      !status.in.includes(row.status)
    ) {
      return false;
    }
    const absentAttempt = where.NOT as
      { payload?: { path?: string[] } } | undefined;
    if (absentAttempt?.payload?.path?.includes('providerAttempt')) {
      const payload = row.payload;
      const attempt =
        payload && typeof payload === 'object' && 'providerAttempt' in payload
          ? payload.providerAttempt
          : undefined;
      const at =
        attempt && typeof attempt === 'object' && 'at' in attempt
          ? (attempt as { at?: unknown }).at
          : undefined;
      if (typeof at === 'string' && at.length > 0) {
        return false;
      }
    }
    const lease = where.OR as Array<Record<string, unknown>> | undefined;
    if (lease) {
      const open = lease.some((item) => {
        if ('lease_until' in item && item.lease_until === null) {
          return row.lease_until == null;
        }
        const before = item.lease_until as { lt?: Date } | undefined;
        return (
          row.lease_until != null &&
          before?.lt != null &&
          row.lease_until.getTime() < before.lt.getTime()
        );
      });
      if (!open) {
        return false;
      }
    }
    return true;
  };
  const apply = (row: DispatchRow, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        (row as unknown as Record<string, unknown>)[key] = value;
      }
    }
  };
  let nextLog = 1;
  const ledger = new Set<string>();
  const prisma = {
    local_fields: {
      findMany: async () => [
        { local_field_id: 10, timezone: 'America/Mexico_City' },
      ],
    },
    $queryRaw: async (sql: unknown) => {
      const values = (sql as { values: unknown[] }).values;
      const [ids, roles, dates] = values as [number[], string[], string[]];
      const inserted: Array<{
        local_field_id: number;
        role: string;
        local_date: string;
      }> = [];
      ids.forEach((id, index) => {
        const key = `${id}:${roles[index]}:${dates[index]}`;
        if (!ledger.has(key)) {
          ledger.add(key);
          inserted.push({
            local_field_id: id,
            role: roles[index],
            local_date: dates[index],
          });
        }
      });
      return inserted;
    },
    investiture_message_dispatches: {
      createMany: async ({ data }: { data: DispatchRow[] }) => {
        let count = 0;
        for (const item of data) {
          const duplicate = dispatches.some(
            (row) =>
              row.kind === item.kind &&
              row.execution_key === item.execution_key &&
              row.recipient_user_id === item.recipient_user_id &&
              row.role === item.role &&
              row.scope_key === item.scope_key,
          );
          if (duplicate) {
            continue;
          }
          dispatches.push({
            lease_until: null,
            claim_token: null,
            sent_at: null,
            last_error: null,
            ...item,
            payload: item.payload ?? {},
          });
          count += 1;
        }
        return { count };
      },
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        dispatches.find((row) => matchesDispatch(row, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        dispatches.filter((row) => matchesDispatch(row, where)),
      create: async ({ data }: { data: DispatchRow }) => {
        if (
          dispatches.some((row) =>
            matchesDispatch(row, {
              kind: data.kind,
              execution_key: data.execution_key,
              recipient_user_id: data.recipient_user_id,
              role: data.role,
              scope_key: data.scope_key,
            }),
          )
        ) {
          const error = new Error('unique') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        dispatches.push({
          lease_until: null,
          claim_token: null,
          sent_at: null,
          last_error: null,
          attempts: 0,
          ...data,
          payload: data.payload ?? {},
        });
        return data;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        if (state.failSentAck && data.status === 'sent') {
          state.failSentAck = false;
          throw new Error('ack write failed');
        }
        const found = dispatches.filter((row) => matchesDispatch(row, where));
        for (const row of found) {
          apply(row, data);
        }
        return { count: found.length };
      },
    },
    investiture_authorization_requests: {
      findUnique: async () => {
        if (state.failRequestRead) {
          throw new Error('transient post-commit read failure');
        }
        return request;
      },
      findMany: async () => [request],
    },
    investiture_authorization_people: {
      findMany: async ({ where }: { where?: Record<string, unknown> }) => {
        const current = person();
        if (!state.pending && where?.status === 'PENDING') {
          return [];
        }
        if (where?.status && current.status !== where.status) {
          return [];
        }
        const ids = where?.person_id as { in?: string[] } | undefined;
        if (ids?.in && !ids.in.includes(current.person_id)) {
          return [];
        }
        const enrollments = where?.enrollment_id as
          { in?: number[] } | undefined;
        if (
          enrollments?.in &&
          !enrollments.in.includes(current.enrollment_id)
        ) {
          return [];
        }
        return [current];
      },
    },
    club_sections: {
      findUnique: async () => section,
      findMany: async () => [section],
    },
    ecclesiastical_years: {
      findMany: async () => [
        {
          year_id: 1,
          active: state.yearActive,
          start_date: new Date('2026-01-01T00:00:00.000Z'),
          end_date: new Date('2026-12-31T00:00:00.000Z'),
        },
      ],
    },
    local_field_investiture_windows: {
      findMany: async () =>
        state.window
          ? [
              {
                local_field_id: 10,
                ecclesiastical_year_id: 1,
                start_date: state.window.start_date,
                end_date: state.window.end_date,
              },
            ]
          : [],
    },
    district_investiture_pastors: {
      findMany: async () =>
        state.pastorActive
          ? [
              { user_id: PASTOR, districlub_type_id: 4, active: true },
              ...(state.extraPastor
                ? [
                    {
                      user_id: OTHER_PASTOR,
                      districlub_type_id: 4,
                      active: true,
                    },
                  ]
                : []),
            ]
          : [],
    },
    users_roles: {
      findMany: async ({
        where,
      }: {
        where?: { roles?: { role_name?: string | { in?: string[] } } };
      } = {}) => {
        const roleName = where?.roles?.role_name;
        if (roleName === 'pastor') {
          return state.pastorActive
            ? [
                { user_id: PASTOR },
                ...(state.extraPastor ? [{ user_id: OTHER_PASTOR }] : []),
              ]
            : [];
        }
        return state.includeOfficer
          ? [
              {
                users: {
                  user_id: DIRECTOR,
                  email: 'director@example.test',
                  local_field_id: state.officerFieldId,
                },
                roles: { role_name: 'director-lf' },
              },
            ]
          : [];
      },
    },
    club_role_assignments: {
      findMany: async () => [
        {
          user_id: DIRECTOR,
          active: true,
          status: 'active',
          club_section_id: 1,
          ecclesiastical_year_id: 1,
          roles: { role_name: 'director' },
        },
      ],
    },
    users: {
      findMany: async ({ where }: { where: { user_id: { in: string[] } } }) =>
        where.user_id.in.map((id) => ({
          user_id: id,
          name: id === PERSON ? 'Ana' : id === ACTOR ? 'Campo' : 'Pastor',
          paternal_last_name: null,
          maternal_last_name: null,
          email: `${id.slice(0, 8)}@example.test`,
          active: !state.deletedAccounts.has(id),
          users_roles: state.rolelessUsers.has(id)
            ? []
            : [{ user_role_id: 'role-pastor' }],
        })),
    },
    classes: {
      findMany: async () => [{ class_id: 1, name: 'Amigo' }],
    },
    notification_logs: {
      create: async ({
        data,
      }: {
        data: {
          title: string;
          body: string;
          source?: string | null;
          idempotency_key?: string | null;
          target_id?: string | null;
        };
      }) => {
        if (
          data.idempotency_key &&
          logs.some((row) => row.idempotency_key === data.idempotency_key)
        ) {
          const error = new Error('unique') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        const row = {
          log_id: nextLog,
          ...data,
          source: data.source ?? null,
          idempotency_key: data.idempotency_key ?? null,
          target_id: data.target_id ?? null,
        };
        nextLog += 1;
        logs.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { idempotency_key: string } }) =>
        logs.find((row) => row.idempotency_key === where.idempotency_key) ??
        null,
    },
    notification_deliveries: {
      create: async ({
        data,
      }: {
        data: { log_id: number; user_id: string };
      }) => {
        deliveries.push(data);
        return data;
      },
    },
    $transaction: async (
      fn: (tx: unknown) => Promise<unknown>,
      _options?: { maxWait?: number; timeout?: number },
    ) => {
      if (state.failInbox) {
        throw new Error('inbox unavailable');
      }
      return fn(prisma);
    },
  };
  prisma.notification_logs.findUnique = async ({ where }) => {
    const row =
      logs.find((item) => item.idempotency_key === where.idempotency_key) ??
      null;
    if (!row) {
      return null;
    }
    return {
      ...row,
      deliveries: deliveries.filter((item) => item.log_id === row.log_id),
    };
  };
  return { prisma, state, dispatches, logs, deliveries, ledger };
}

export function serviceOf(
  prisma: ReturnType<typeof world>['prisma'],
  email: {
    sendInvestitureNotice: (input: {
      dispatchId: string;
      kind?: 'PRESENTATION' | 'REMINDER' | 'RESULT';
    }) => Promise<void>;
    inspectInvestitureJob?: (
      jobId: string,
    ) => Promise<'unsupported' | 'missing' | 'failed' | 'done' | 'busy'>;
    retryFailedInvestitureJob?: (jobId: string) => Promise<void>;
  },
) {
  const service = new InvestitureCommunicationsService(
    prisma as never,
    email as never,
    { pushBestEffort: async () => undefined } as never,
    { get: () => 'https://admin.example.test' } as never,
  );
  service.bindClock(() => new Date('2026-10-05T16:00:00.000Z'));
  return service;
}

describe('investiture communication delivery', () => {
  const monday = new Date('2026-10-05T16:00:00.000Z');
  const previousInvestitureEmail = process.env.INVESTITURE_EMAIL_ENABLED;
  const previousGlobalEmail = process.env.EMAIL_ENABLED;

  beforeEach(() => {
    process.env.INVESTITURE_EMAIL_ENABLED = 'true';
    process.env.EMAIL_ENABLED = 'true';
  });

  afterAll(() => {
    if (previousInvestitureEmail === undefined) {
      delete process.env.INVESTITURE_EMAIL_ENABLED;
    } else {
      process.env.INVESTITURE_EMAIL_ENABLED = previousInvestitureEmail;
    }
    if (previousGlobalEmail === undefined) {
      delete process.env.EMAIL_ENABLED;
    } else {
      process.env.EMAIL_ENABLED = previousGlobalEmail;
    }
  });

  it('keeps the presentation intent when the read fails and does not duplicate the rest', async () => {
    const { prisma, state, dispatches } = world();
    state.failRequestRead = true;
    state.includeOfficer = false;
    const queued: string[] = [];
    let queueFailures = 1;
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async ({ dispatchId }) => {
        if (queueFailures > 0) {
          queueFailures -= 1;
          throw new Error('queue down');
        }
        queued.push(dispatchId);
      },
    });

    await service.recordPresentation({
      requestId: REQUEST,
      enrollmentIds: [1],
    });
    expect(dispatches.some((row) => row.role === 'intent')).toBe(true);
    expect(queued).toEqual([]);
    expect(await service.deliverPending()).toBe(0);

    state.failRequestRead = false;
    const first = await service.deliverPending();
    const second = await service.deliverPending();
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(new Set(queued).size).toBe(queued.length);
    expect(queued.length).toBe(2);
    expect(dispatches.filter((row) => row.role === 'pastor')).toHaveLength(2);
  });

  it('does not remind a person closed at year end while the calendar is still open', async () => {
    const { prisma, state } = world();
    state.personStatus = 'CLOSED_YEAR';
    state.includeOfficer = false;
    state.extraPastor = false;
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => {
        throw new Error('should not send');
      },
    });

    expect(await service.dispatchReminders(monday)).toBe(0);
  });

  it('does not retry a reminder to a revoked pastor, a moved officer, or a closed year', async () => {
    const { prisma, state, dispatches } = world();
    const sent: string[] = [];
    let fail = true;
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => {
        if (fail) {
          throw new Error('queue down');
        }
        sent.push('mail');
      },
    });
    expect(await service.dispatchReminders(monday)).toBe(0);
    expect(
      dispatches.some(
        (row) => row.kind === 'REMINDER' && row.status === 'failed',
      ),
    ).toBe(true);

    state.pastorActive = false;
    state.officerFieldId = 11;
    fail = false;
    expect(await service.deliverPending(monday)).toBe(0);
    expect(sent).toEqual([]);
    expect(
      dispatches
        .filter((row) => row.role === 'pastor')
        .every((row) => row.status === 'skipped'),
    ).toBe(true);

    const moved = dispatches.find((row) => row.role === 'director-lf');
    expect(moved?.status).toBe('skipped');

    state.yearActive = false;
    state.pending = false;
    const fresh = await service.prepare(
      dispatches.find((row) => row.role === 'pastor')?.dispatch_id ?? '',
    );
    expect(fresh).toBeNull();
  });

  it('rebuilds a retry with the default open window', async () => {
    const { prisma, state, dispatches } = world();
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    expect(await service.dispatchReminders(monday)).toBeGreaterThan(0);
    const pastor = dispatches.find((row) => row.role === 'pastor');
    const fresh = await service.prepare(pastor?.dispatch_id ?? '');
    expect(fresh?.paragraphs.join('\n')).not.toContain(
      'ventana de autorización está cerrada',
    );
    expect(fresh?.paragraphs.some((line) => line.includes('Ana'))).toBe(true);

    state.window = {
      start_date: new Date('2026-10-01T00:00:00.000Z'),
      end_date: new Date('2026-10-03T00:00:00.000Z'),
    };
    const closed = await service.prepare(pastor?.dispatch_id ?? '');
    expect(closed?.paragraphs).toContain(INVESTITURE_WINDOW_CLOSED_REMINDER);
  });

  it('C1 R26-4 skips open presentation and reminder rows and leaves results alone', async () => {
    const previousInvestiture = process.env.INVESTITURE_EMAIL_ENABLED;
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.INVESTITURE_EMAIL_ENABLED = 'false';
    process.env.EMAIL_ENABLED = 'true';
    const { prisma, dispatches } = world();
    const statuses = ['pending', 'failed', 'queued', 'sending'] as const;
    for (const status of statuses) {
      for (const kind of ['PRESENTATION', 'REMINDER'] as const) {
        dispatches.push({
          dispatch_id: `${kind}-${status}`,
          kind,
          execution_key: `${kind}-${status}`,
          recipient_user_id: PASTOR,
          role: 'pastor',
          scope_key: 'scope',
          status,
          attempts: 0,
          payload: {},
          lease_until: null,
          claim_token: null,
          sent_at: null,
          last_error: null,
        });
      }
    }
    dispatches.push({
      dispatch_id: 'result-pending',
      kind: 'RESULT',
      execution_key: 'result-pending',
      recipient_user_id: PERSON,
      role: 'member',
      scope_key: 'result',
      status: 'pending',
      attempts: 0,
      payload: {},
      lease_until: null,
      claim_token: null,
      sent_at: null,
      last_error: null,
    });
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    try {
      expect(await service.deliverPending(monday)).toBe(0);
      const skipped = dispatches.filter(
        (row) =>
          (row.kind === 'PRESENTATION' || row.kind === 'REMINDER') &&
          row.status === 'skipped' &&
          row.last_error === 'investiture_email_disabled',
      );
      expect(skipped).toHaveLength(8);
      expect(dispatches.find((row) => row.kind === 'RESULT')?.status).toBe(
        'pending',
      );
    } finally {
      process.env.EMAIL_ENABLED = previousEmail;
      if (previousInvestiture === undefined) {
        delete process.env.INVESTITURE_EMAIL_ENABLED;
      } else {
        process.env.INVESTITURE_EMAIL_ENABLED = previousInvestiture;
      }
    }
  });

  it('C1RR-1 marks a provider attempt uncertain and skips only rows that never reached the provider', async () => {
    const previousInvestiture = process.env.INVESTITURE_EMAIL_ENABLED;
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.INVESTITURE_EMAIL_ENABLED = 'false';
    process.env.EMAIL_ENABLED = 'true';
    const recent = new Date().toISOString();
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const attempt = (at: string) => ({
      at,
      body: JSON.stringify({
        to: 'pastor@example.test',
        from: 'SACDIA <noreply@example.test>',
        subject: 'Aviso',
        html: '<p>hola</p>',
        text: 'hola',
      }),
    });
    const { prisma, dispatches } = world();
    const jobOnly = world();
    const rows = [
      ['A', 'queued', attempt(recent)],
      ['B', 'queued', attempt(recent)],
      ['none', 'queued', {}],
      ['old', 'queued', attempt(stale)],
    ] as const;
    for (const [name, status, payload] of rows) {
      dispatches.push({
        dispatch_id: `c1rr-${name}`,
        kind: 'REMINDER',
        execution_key: `c1rr-${name}`,
        recipient_user_id: PASTOR,
        role: 'pastor',
        scope_key: `c1rr-${name}`,
        status,
        attempts: name === 'none' ? 0 : 1,
        payload: { providerAttempt: payload },
        lease_until: null,
        claim_token: null,
        sent_at: null,
        last_error: null,
      });
    }
    jobOnly.dispatches.push({
      dispatch_id: 'c1rr-C',
      kind: 'REMINDER',
      execution_key: 'c1rr-C',
      recipient_user_id: PASTOR,
      role: 'pastor',
      scope_key: 'c1rr-C',
      status: 'queued',
      attempts: 1,
      payload: { providerAttempt: attempt(recent) },
      lease_until: null,
      claim_token: null,
      sent_at: null,
      last_error: null,
    });
    const sent: string[] = [];
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    const processor = noticeProcessor(service, async () => {
      sent.push('sent');
      return { messageId: 'should-not-send' };
    });
    const jobService = serviceOf(jobOnly.prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    const jobProcessor = noticeProcessor(jobService, async () => {
      sent.push('sent');
      return { messageId: 'should-not-send' };
    });
    const row = (name: string) =>
      dispatches.find((item) => item.dispatch_id === `c1rr-${name}`);
    try {
      await service.deliverPending(monday);
      await processor.process(noticeJob('c1rr-B'));
      await jobProcessor.process(noticeJob('c1rr-C'));
      expect(sent).toEqual([]);
      for (const name of ['A', 'B', 'old']) {
        expect(row(name)?.status).toBe('uncertain');
      }
      expect(jobOnly.dispatches[0]?.status).toBe('uncertain');
      expect(row('none')?.status).toBe('skipped');
      expect(row('none')?.last_error).toBe('investiture_email_disabled');
      for (const name of ['A', 'B']) {
        expect(row(name)?.last_error ?? '').not.toContain('24 horas');
      }
      expect(jobOnly.dispatches[0]?.last_error ?? '').not.toContain('24 horas');
      expect(row('old')?.last_error ?? '').toContain('24 horas');
    } finally {
      process.env.EMAIL_ENABLED = previousEmail;
      if (previousInvestiture === undefined) {
        delete process.env.INVESTITURE_EMAIL_ENABLED;
      } else {
        process.env.INVESTITURE_EMAIL_ENABLED = previousInvestiture;
      }
    }
  });

  it('C1R-N3 recovers a failed result into the inbox while investiture email is off', async () => {
    const previousInvestiture = process.env.INVESTITURE_EMAIL_ENABLED;
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.INVESTITURE_EMAIL_ENABLED = 'false';
    process.env.EMAIL_ENABLED = 'false';
    const { prisma, state, dispatches, deliveries } = world();
    state.personStatus = 'INVESTED';
    state.pending = true;
    const sent: string[] = [];
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async ({ dispatchId }) => {
        sent.push(dispatchId);
      },
    });
    state.failInbox = true;
    await service.recordResults({
      requestId: REQUEST,
      actorId: ACTOR,
      investedIds: [PERSON],
      rejectedPersonIds: [],
      rejectedSystemIds: [],
    });
    expect(deliveries).toHaveLength(0);
    expect(
      dispatches.some(
        (row) =>
          row.kind === 'RESULT' &&
          row.role !== 'intent' &&
          row.status === 'failed',
      ),
    ).toBe(true);

    state.failInbox = false;
    try {
      const recovered = await service.deliverPending();
      expect(recovered).toBeGreaterThan(0);
      expect(deliveries).toHaveLength(2);
      expect(sent).toEqual([]);
      const again = await service.deliverPending();
      expect(again).toBe(0);
      expect(deliveries).toHaveLength(2);
      expect(
        dispatches
          .filter((row) => row.kind === 'RESULT' && row.role !== 'intent')
          .every((row) => row.status === 'sent'),
      ).toBe(true);
    } finally {
      process.env.EMAIL_ENABLED = previousEmail;
      if (previousInvestiture === undefined) {
        delete process.env.INVESTITURE_EMAIL_ENABLED;
      } else {
        process.env.INVESTITURE_EMAIL_ENABLED = previousInvestiture;
      }
    }
  });

  it('C1R-N4 leaves a provider attempt uncertain when the switch is off', async () => {
    const previousInvestiture = process.env.INVESTITURE_EMAIL_ENABLED;
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.INVESTITURE_EMAIL_ENABLED = 'false';
    process.env.EMAIL_ENABLED = 'true';
    const { prisma, dispatches } = world();
    const row = {
      dispatch_id: 'reminder-attempt',
      kind: 'REMINDER' as const,
      execution_key: 'reminder-attempt',
      recipient_user_id: PASTOR,
      role: 'pastor',
      scope_key: 'scope',
      status: 'queued',
      attempts: 1,
      payload: {
        providerAttempt: {
          at: new Date().toISOString(),
          body: JSON.stringify({
            to: 'pastor@example.test',
            from: 'SACDIA <noreply@example.test>',
            subject: 'Aviso',
            html: '<p>hola</p>',
            text: 'hola',
          }),
        },
      },
      lease_until: null,
      claim_token: null,
      sent_at: null,
      last_error: null,
    };
    dispatches.push(row);
    const sent: string[] = [];
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    const processor = noticeProcessor(service, async () => {
      sent.push('sent');
      return { messageId: 'should-not-send' };
    });
    try {
      await processor.process(noticeJob(row.dispatch_id));
      expect(sent).toEqual([]);
      expect(row.status).toBe('uncertain');
    } finally {
      process.env.EMAIL_ENABLED = previousEmail;
      if (previousInvestiture === undefined) {
        delete process.env.INVESTITURE_EMAIL_ENABLED;
      } else {
        process.env.INVESTITURE_EMAIL_ENABLED = previousInvestiture;
      }
    }
  });

  it('R26-3 does not send a queued investiture job after the switch is turned off', async () => {
    const previousInvestiture = process.env.INVESTITURE_EMAIL_ENABLED;
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.INVESTITURE_EMAIL_ENABLED = 'true';
    process.env.EMAIL_ENABLED = 'true';
    const { prisma, dispatches } = world();
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    try {
      expect(await service.dispatchReminders(monday)).toBeGreaterThan(0);
      const row = dispatches.find(
        (item) => item.kind === 'REMINDER' && item.status === 'queued',
      );
      expect(row).toBeTruthy();
      process.env.INVESTITURE_EMAIL_ENABLED = 'false';
      const sent: string[] = [];
      const processor = noticeProcessor(service, async () => {
        sent.push('sent');
        return { messageId: 'should-not-send' };
      });
      await processor.process(noticeJob(row!.dispatch_id));
      expect(sent).toEqual([]);
      expect(row!.status).toBe('skipped');
      expect(row!.last_error).toBe('investiture_email_disabled');
    } finally {
      process.env.EMAIL_ENABLED = previousEmail;
      if (previousInvestiture === undefined) {
        delete process.env.INVESTITURE_EMAIL_ENABLED;
      } else {
        process.env.INVESTITURE_EMAIL_ENABLED = previousInvestiture;
      }
    }
  });

  it('R26-5 does not flush a queued investiture job when global email is turned on later', async () => {
    const previousInvestiture = process.env.INVESTITURE_EMAIL_ENABLED;
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.INVESTITURE_EMAIL_ENABLED = 'true';
    process.env.EMAIL_ENABLED = 'true';
    const { prisma, dispatches } = world();
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    const sent: string[] = [];
    try {
      expect(await service.dispatchReminders(monday)).toBeGreaterThan(0);
      const row = dispatches.find(
        (item) => item.kind === 'REMINDER' && item.status === 'queued',
      );
      expect(row).toBeTruthy();
      process.env.EMAIL_ENABLED = 'false';
      const processor = noticeProcessor(service, async () => {
        sent.push('sent');
        return { messageId: 'should-not-flush' };
      });
      await processor.process(noticeJob(row!.dispatch_id));
      expect(sent).toEqual([]);
      expect(row!.status).toBe('skipped');
      expect(row!.last_error).toBe('investiture_email_disabled');
      process.env.EMAIL_ENABLED = 'true';
      await processor.process(noticeJob(row!.dispatch_id));
      expect(sent).toEqual([]);
      expect(row!.status).toBe('skipped');
    } finally {
      process.env.EMAIL_ENABLED = previousEmail;
      if (previousInvestiture === undefined) {
        delete process.env.INVESTITURE_EMAIL_ENABLED;
      } else {
        process.env.INVESTITURE_EMAIL_ENABLED = previousInvestiture;
      }
    }
  });

  it('does not send investiture mail while the switch is off and does not flush it later', async () => {
    const previous = process.env.INVESTITURE_EMAIL_ENABLED;
    delete process.env.INVESTITURE_EMAIL_ENABLED;
    const { prisma, dispatches, logs } = world();
    const sent: string[] = [];
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async ({ dispatchId }) => {
        sent.push(dispatchId);
      },
    });
    try {
      expect(await service.dispatchReminders(monday)).toBe(0);
      expect(sent).toEqual([]);
      process.env.INVESTITURE_EMAIL_ENABLED = 'true';
      expect(await service.deliverPending(monday)).toBe(0);
      expect(sent).toEqual([]);
      expect(
        dispatches
          .filter((row) => row.kind === 'REMINDER')
          .every((row) => row.status === 'skipped'),
      ).toBe(true);
      expect(logs).toEqual([]);
    } finally {
      if (previous === undefined) {
        delete process.env.INVESTITURE_EMAIL_ENABLED;
      } else {
        process.env.INVESTITURE_EMAIL_ENABLED = previous;
      }
    }
  });

  it('tags the result push with the app destination and leaves the inbox rows alone', async () => {
    const { prisma, state, logs } = world();
    state.personStatus = 'INVESTED';
    state.pending = true;
    const pushes: Array<{
      userId: string;
      data?: Record<string, string>;
      source?: string;
    }> = [];
    const service = new InvestitureCommunicationsService(
      prisma as never,
      { sendInvestitureNotice: async () => undefined } as never,
      {
        pushBestEffort: async (
          input: { userId: string; data?: Record<string, string> },
          source?: string,
        ) => {
          pushes.push({ userId: input.userId, data: input.data, source });
        },
      } as never,
      { get: () => 'https://admin.example.test' } as never,
    );
    service.bindClock(() => new Date('2026-10-05T16:00:00.000Z'));

    await service.recordResults({
      requestId: REQUEST,
      actorId: ACTOR,
      investedIds: [PERSON],
      rejectedPersonIds: [],
      rejectedSystemIds: [],
    });

    const person = pushes.find((push) => push.userId === PERSON);
    expect(person?.data).toEqual({
      type: 'investiture_result',
      audience: 'person',
      requestId: REQUEST,
      sectionId: '1',
      classId: '1',
    });
    const board = pushes.find((push) => push.userId !== PERSON);
    expect(board?.data).toEqual({
      type: 'investiture_result',
      audience: 'board',
      requestId: REQUEST,
      sectionId: '1',
    });
    expect(board?.data).not.toHaveProperty('classId');
    expect(pushes.every((push) => push.source === 'investiture:invested')).toBe(
      true,
    );
    expect(JSON.stringify(logs)).not.toContain('investiture_result');
  });

  it('keeps the destination when a failed result is recovered from the stored payload', async () => {
    const { prisma, state, dispatches } = world();
    state.personStatus = 'INVESTED';
    state.pending = true;
    const pushes: Array<{ userId: string; data?: Record<string, string> }> = [];
    const service = new InvestitureCommunicationsService(
      prisma as never,
      { sendInvestitureNotice: async () => undefined } as never,
      {
        pushBestEffort: async (input: {
          userId: string;
          data?: Record<string, string>;
        }) => {
          pushes.push({ userId: input.userId, data: input.data });
        },
      } as never,
      { get: () => 'https://admin.example.test' } as never,
    );
    service.bindClock(() => new Date('2026-10-05T16:00:00.000Z'));
    state.failInbox = true;
    await service.recordResults({
      requestId: REQUEST,
      actorId: ACTOR,
      investedIds: [PERSON],
      rejectedPersonIds: [],
      rejectedSystemIds: [],
    });
    expect(pushes).toHaveLength(0);
    const stored = dispatches.find(
      (row) => row.kind === 'RESULT' && row.role === 'person',
    );
    expect(stored?.payload).toMatchObject({
      audience: 'person',
      sectionId: 1,
      classId: 1,
    });

    state.failInbox = false;
    await service.deliverPending();

    expect(pushes.find((push) => push.userId === PERSON)?.data).toEqual({
      type: 'investiture_result',
      audience: 'person',
      requestId: REQUEST,
      sectionId: '1',
      classId: '1',
    });
  });

  it('recovers a result stored before the push carried a destination', async () => {
    const { prisma, dispatches } = world();
    dispatches.push({
      dispatch_id: 'legacy-result',
      kind: 'RESULT',
      execution_key: 'person-invested:legacy',
      recipient_user_id: PERSON,
      role: 'person',
      scope_key: `user:${PERSON}`,
      status: 'failed',
      attempts: 1,
      payload: {
        channel: 'result',
        title: 'Investidura autorizada',
        body: 'texto',
        source: 'investiture:invested',
        requestId: REQUEST,
      },
      lease_until: null,
      claim_token: null,
      sent_at: null,
      last_error: 'boom',
    });
    const pushes: Array<Record<string, string> | undefined> = [];
    const service = new InvestitureCommunicationsService(
      prisma as never,
      { sendInvestitureNotice: async () => undefined } as never,
      {
        pushBestEffort: async (input: { data?: Record<string, string> }) => {
          pushes.push(input.data);
        },
      } as never,
      { get: () => 'https://admin.example.test' } as never,
    );
    service.bindClock(() => new Date('2026-10-05T16:00:00.000Z'));

    await service.deliverPending();

    expect(pushes).toEqual([
      {
        type: 'investiture_result',
        audience: 'person',
        requestId: REQUEST,
        sectionId: '1',
      },
    ]);
  });

  it('R6 skips an old result whose request no longer exists with an explicit cause', async () => {
    const { prisma, dispatches } = world();
    dispatches.push({
      dispatch_id: 'orphan-result',
      kind: 'RESULT',
      execution_key: 'person-invested:orphan',
      recipient_user_id: PERSON,
      role: 'person',
      scope_key: `user:${PERSON}`,
      status: 'failed',
      attempts: 1,
      payload: {
        channel: 'result',
        title: 'Investidura autorizada',
        body: 'texto',
        source: 'investiture:invested',
        requestId: REQUEST,
      },
      lease_until: null,
      claim_token: null,
      sent_at: null,
      last_error: 'boom',
    });
    let reads = 0;
    prisma.investiture_authorization_requests.findUnique = async () => {
      reads += 1;
      return null;
    };
    const pushes: unknown[] = [];
    const service = new InvestitureCommunicationsService(
      prisma as never,
      { sendInvestitureNotice: async () => undefined } as never,
      {
        pushBestEffort: async (input: unknown) => {
          pushes.push(input);
        },
      } as never,
      { get: () => 'https://admin.example.test' } as never,
    );
    service.bindClock(() => new Date('2026-10-05T16:00:00.000Z'));
    const logged = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const errored = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    try {
      await service.deliverPending();
      const row = dispatches.find(
        (item) => item.dispatch_id === 'orphan-result',
      );
      expect(row).toMatchObject({
        status: 'skipped',
        last_error: 'request_missing',
      });
      expect(pushes).toEqual([]);
      const readsAfterFirstRun = reads;
      logged.mockClear();

      await service.deliverPending();

      expect(reads).toBe(readsAfterFirstRun);
      expect(
        logged.mock.calls.filter(([message]) =>
          String(message).includes('orphan-result'),
        ),
      ).toEqual([]);
      expect(errored).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      errored.mockRestore();
    }
  });

  it('retries a lost inbox without hiding it or duplicating it', async () => {
    const { prisma, state, dispatches, deliveries } = world();
    state.personStatus = 'INVESTED';
    state.pending = true;
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    state.failInbox = true;
    await service.recordResults({
      requestId: REQUEST,
      actorId: ACTOR,
      investedIds: [PERSON],
      rejectedPersonIds: [],
      rejectedSystemIds: [],
    });
    expect(deliveries).toHaveLength(0);
    expect(
      dispatches.some(
        (row) =>
          row.channel === undefined &&
          row.kind === 'RESULT' &&
          row.role !== 'intent' &&
          row.status === 'failed',
      ),
    ).toBe(true);

    state.failInbox = false;
    state.failSentAck = true;
    await service.deliverPending();
    expect(deliveries).toHaveLength(2);
    expect(
      dispatches.some(
        (row) =>
          row.kind === 'RESULT' &&
          row.role !== 'intent' &&
          row.status === 'failed',
      ),
    ).toBe(true);

    const again = await service.deliverPending();
    expect(again).toBeGreaterThan(0);
    expect(deliveries).toHaveLength(2);
    expect(
      dispatches
        .filter((row) => row.kind === 'RESULT' && row.role !== 'intent')
        .every((row) => row.status === 'sent'),
    ).toBe(true);
    expect(
      dispatches
        .filter((row) => row.kind === 'RESULT' && row.role !== 'intent')
        .every(
          (row) => !String(row.payload.body).includes('motivo-humano-privado'),
        ),
    ).toBe(true);
    expect(
      dispatches
        .filter((row) => row.kind === 'RESULT' && row.role !== 'intent')
        .every(
          (row) => !String(row.payload.body).includes('comentario-privado'),
        ),
    ).toBe(true);
  });

  it('lets two concurrent inbox retries share one delivery', async () => {
    const { prisma, state, deliveries, dispatches } = world();
    state.personStatus = 'INVESTED';
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    state.failInbox = true;
    await service.recordResults({
      requestId: REQUEST,
      actorId: ACTOR,
      investedIds: [PERSON],
      rejectedPersonIds: [],
      rejectedSystemIds: [],
    });
    state.failInbox = false;
    await Promise.all([service.deliverPending(), service.deliverPending()]);
    const resultRows = dispatches.filter(
      (row) => row.kind === 'RESULT' && row.role !== 'intent',
    );
    expect(resultRows.every((row) => row.status === 'sent')).toBe(true);
    expect(deliveries.length).toBe(resultRows.length);
  });

  it('recovers only the recipient that was not stored when the pending group shrinks', async () => {
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = 'true';
    const { prisma, state, dispatches } = world();
    state.includeOfficer = true;
    state.extraPastor = false;
    const original = prisma.investiture_authorization_people.findMany;
    prisma.investiture_authorization_people.findMany = async (args) => {
      const [ana] = await original({ where: {} });
      const people = [
        ana,
        {
          ...ana,
          person_id: BRUNO,
          user_id: BRUNO,
          enrollment_id: 2,
          status: 'PENDING',
        },
      ];
      const where = args?.where ?? {};
      return people.filter((person) => {
        if (where.status && person.status !== where.status) {
          return false;
        }
        const ids = (where.person_id as { in?: string[] } | undefined)?.in;
        if (ids && !ids.includes(person.person_id)) {
          return false;
        }
        const enrollments = (
          where.enrollment_id as { in?: number[] } | undefined
        )?.in;
        return !enrollments || enrollments.includes(person.enrollment_id);
      });
    };
    const create = prisma.investiture_message_dispatches.create;
    let failDirector = true;
    prisma.investiture_message_dispatches.create = async (args) => {
      if (failDirector && args.data.role === 'director-lf') {
        failDirector = false;
        throw new Error('second recipient insert failed');
      }
      return create(args);
    };
    const jobs: Array<{ dispatchId: string }> = [];
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async ({ dispatchId }) => {
        jobs.push({ dispatchId });
      },
    });
    const accepted: string[] = [];
    const processor = noticeProcessor(service, async (payload) => {
      accepted.push(payload.to);
      return { messageId: `accepted-${accepted.length}` };
    });

    try {
      await service.recordPresentation({
        requestId: REQUEST,
        enrollmentIds: [1, 2],
      });
      expect(jobs).toHaveLength(1);
      await processor.process(noticeJob(jobs[0].dispatchId));
      state.personStatus = 'INVESTED';
      await service.deliverPending(monday);
      for (const job of jobs.slice(1)) {
        await processor.process(noticeJob(job.dispatchId));
      }

      const pastors = dispatches.filter((row) => row.role === 'pastor');
      expect(pastors).toHaveLength(1);
      expect(new Set(pastors.map((row) => row.execution_key)).size).toBe(1);
      expect(accepted.filter((to) => to.startsWith('11111111'))).toHaveLength(
        1,
      );
      expect(dispatches.some((row) => row.role === 'director-lf')).toBe(true);
    } finally {
      process.env.EMAIL_ENABLED = previousEmail;
    }
  });

  it('repeats the accepted provider payload and stops after the 24 hour horizon', async () => {
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = 'true';
    try {
      const changed = await lostAck(monday);
      changed.state.window = {
        start_date: new Date('2026-10-01T00:00:00.000Z'),
        end_date: new Date('2026-10-03T00:00:00.000Z'),
      };
      await changed.processor.process(noticeJob(changed.dispatchId));
      expect(changed.bodies.size).toBe(1);
      expect([...changed.bodies.values()][0]).not.toContain(
        'ventana de autorización está cerrada',
      );
      expect(changed.row.status).toBe('sent');

      const expired = await lostAck(monday);
      const attempt = (
        expired.row.payload as { providerAttempt?: { at: string } }
      ).providerAttempt;
      expect(attempt).toBeDefined();
      attempt!.at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const callsBefore = expired.calls;
      await expired.processor.process(noticeJob(expired.dispatchId));
      expect(expired.calls).toBe(callsBefore);
      expect(expired.row.status).toBe('uncertain');
    } finally {
      process.env.EMAIL_ENABLED = previousEmail;
    }
  });

  it('does not send a frozen reminder when the recipient, year, or pending group is gone', async () => {
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = 'true';
    try {
      for (const change of ['pastor', 'field', 'year', 'pending'] as const) {
        const { prisma, state, dispatches } = world();
        state.extraPastor = false;
        state.includeOfficer = change === 'field';
        const jobs: Array<{ dispatchId: string }> = [];
        const service = serviceOf(prisma, {
          sendInvestitureNotice: async ({ dispatchId }) => {
            jobs.push({ dispatchId });
          },
        });
        expect(await service.dispatchReminders(monday)).toBeGreaterThan(0);
        const role = change === 'field' ? 'director-lf' : 'pastor';
        const row = dispatches.find((item) => item.role === role);
        expect(row).toBeDefined();
        let calls = 0;
        let accepted = 0;
        const processor = noticeProcessor(service, async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error('provider unavailable before accept');
          }
          accepted += 1;
          return { messageId: 'stale-accepted' };
        });
        await expect(
          processor.process(noticeJob(row!.dispatch_id)),
        ).rejects.toThrow(/provider unavailable/);
        if (change === 'pastor') {
          state.pastorActive = false;
        }
        if (change === 'field') {
          state.officerFieldId = 20;
        }
        if (change === 'year') {
          state.yearActive = false;
        }
        if (change === 'pending') {
          state.pending = false;
        }
        await processor.process(noticeJob(row!.dispatch_id));
        expect(accepted).toBe(0);
        expect(calls).toBe(1);
        expect(row!.status).toBe('skipped');
      }
    } finally {
      process.env.EMAIL_ENABLED = previousEmail;
    }
  });

  it('stops a frozen reminder when one of two districts leaves the pastor', async () => {
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = 'true';
    const secondRequest = '88888888-8888-4888-8888-888888888888';
    try {
      const { prisma, state, dispatches } = world();
      state.extraPastor = false;
      state.includeOfficer = false;
      const [request] =
        await prisma.investiture_authorization_requests.findMany();
      const [person] = await prisma.investiture_authorization_people.findMany({
        where: {},
      });
      const [section] = await prisma.club_sections.findMany();
      prisma.investiture_authorization_requests.findMany = async () => [
        request,
        { ...request, request_id: secondRequest, club_section_id: 2 },
      ];
      prisma.investiture_authorization_people.findMany = async () => [
        person,
        {
          ...person,
          person_id: BRUNO,
          user_id: BRUNO,
          request_id: secondRequest,
          enrollment_id: 2,
        },
      ];
      prisma.club_sections.findMany = async () => [
        section,
        {
          ...section,
          club_section_id: 2,
          clubs: {
            ...section.clubs,
            churches: { districlub_type_id: 5 },
          },
        },
      ];
      const users = prisma.users.findMany.bind(prisma.users);
      prisma.users.findMany = async (args) =>
        (await users(args)).map((user) => ({
          ...user,
          name: user.user_id === BRUNO ? 'BrunoDistritoRevocado' : user.name,
        }));
      let removed = false;
      prisma.district_investiture_pastors.findMany = async () =>
        [4, ...(removed ? [] : [5])].map((id) => ({
          user_id: PASTOR,
          districlub_type_id: id,
          active: true,
        }));
      const jobs: Array<{ dispatchId: string }> = [];
      const service = serviceOf(prisma, {
        sendInvestitureNotice: async ({ dispatchId }) => {
          jobs.push({ dispatchId });
        },
      });
      expect(await service.dispatchReminders(monday)).toBe(1);
      const row = dispatches.find((item) => item.role === 'pastor');
      expect(row).toBeDefined();
      let calls = 0;
      const accepted: string[] = [];
      const processor = noticeProcessor(service, async (payload) => {
        calls += 1;
        if (calls === 1) {
          throw new Error('provider before accept');
        }
        accepted.push((payload as { text?: string }).text ?? '');
        return { messageId: 'partial-scope' };
      });
      await expect(
        processor.process(noticeJob(row!.dispatch_id)),
      ).rejects.toThrow(/provider before accept/);
      const storedBody = (row!.payload.providerAttempt as { body: string })
        .body;
      const stored = JSON.parse(storedBody) as {
        text: string;
        idempotencyKey?: string;
      };
      expect(stored.text).toContain('BrunoDistritoRevocado');
      removed = true;
      const fresh = await service.prepare(row!.dispatch_id);
      expect(fresh?.paragraphs.join(' ')).not.toContain(
        'BrunoDistritoRevocado',
      );
      await processor.process(noticeJob(row!.dispatch_id));
      expect(accepted).toEqual([]);
      expect(calls).toBe(1);
      expect(row!.status).toBe('skipped');
      const after = JSON.parse(
        (row!.payload.providerAttempt as { body: string }).body,
      ) as { text: string; idempotencyKey?: string };
      expect(after.text).toContain('BrunoDistritoRevocado');
      expect(after.idempotencyKey).toBe(stored.idempotencyKey);
    } finally {
      process.env.EMAIL_ENABLED = previousEmail;
    }
  });

  it('keeps body and scope from the same snapshot when a district leaves during render', async () => {
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.EMAIL_ENABLED = 'true';
    const secondRequest = '88888888-8888-4888-8888-888888888888';
    try {
      const { prisma, state, dispatches } = world();
      state.extraPastor = false;
      state.includeOfficer = false;
      const [request] =
        await prisma.investiture_authorization_requests.findMany();
      const [person] = await prisma.investiture_authorization_people.findMany({
        where: {},
      });
      const [section] = await prisma.club_sections.findMany();
      prisma.investiture_authorization_requests.findMany = async () => [
        request,
        { ...request, request_id: secondRequest, club_section_id: 2 },
      ];
      prisma.investiture_authorization_people.findMany = async () => [
        person,
        {
          ...person,
          person_id: BRUNO,
          user_id: BRUNO,
          request_id: secondRequest,
          enrollment_id: 2,
        },
      ];
      prisma.club_sections.findMany = async () => [
        section,
        {
          ...section,
          club_section_id: 2,
          clubs: {
            ...section.clubs,
            churches: { districlub_type_id: 5 },
          },
        },
      ];
      const users = prisma.users.findMany.bind(prisma.users);
      prisma.users.findMany = async (args) =>
        (await users(args)).map((user) => ({
          ...user,
          name: user.user_id === BRUNO ? 'BrunoDistritoRevocado' : user.name,
        }));
      let removed = false;
      prisma.district_investiture_pastors.findMany = async () =>
        [4, ...(removed ? [] : [5])].map((id) => ({
          user_id: PASTOR,
          districlub_type_id: id,
          active: true,
        }));
      const jobs: Array<{ dispatchId: string }> = [];
      const service = serviceOf(prisma, {
        sendInvestitureNotice: async ({ dispatchId }) => {
          jobs.push({ dispatchId });
        },
      });
      expect(await service.dispatchReminders(monday)).toBe(1);
      expect(jobs).toHaveLength(1);
      const row = dispatches.find((item) => item.role === 'pastor');
      expect(row).toBeDefined();
      let calls = 0;
      const accepted: string[] = [];
      const processor = noticeProcessor(service, async (payload) => {
        calls += 1;
        if (calls === 1) {
          throw new Error('provider before accept');
        }
        accepted.push((payload as { text?: string }).text ?? '');
        return { messageId: 'partial-scope' };
      });
      const renderer = processor as unknown as {
        renderTemplate: (
          name: string,
          data: { paragraphs?: string[] },
        ) => Promise<{ text: string }>;
      };
      const render = renderer.renderTemplate.bind(processor);
      renderer.renderTemplate = async (name, data) => {
        const result = await render(name, data);
        removed = true;
        return result;
      };
      await expect(
        processor.process(noticeJob(row!.dispatch_id)),
      ).rejects.toThrow(/provider before accept/);
      const attempt = row!.payload.providerAttempt as {
        body: string;
        scope: { paragraphs: string[] };
      };
      const stored = JSON.parse(attempt.body) as {
        text: string;
        idempotencyKey?: string;
      };
      expect(stored.text).toContain('BrunoDistritoRevocado');
      expect(attempt.scope.paragraphs.join(' ')).toContain(
        'BrunoDistritoRevocado',
      );
      const fresh = await service.prepare(row!.dispatch_id);
      expect(fresh?.paragraphs.join(' ')).not.toContain(
        'BrunoDistritoRevocado',
      );
      await processor.process(noticeJob(row!.dispatch_id));
      expect(accepted).toEqual([]);
      expect(calls).toBe(1);
      expect(row!.status).toBe('skipped');
      const after = JSON.parse(
        (row!.payload.providerAttempt as { body: string }).body,
      ) as { text: string; idempotencyKey?: string };
      expect(after.text).toContain('BrunoDistritoRevocado');
      expect(after.idempotencyKey).toBe(stored.idempotencyKey);
    } finally {
      process.env.EMAIL_ENABLED = previousEmail;
    }
  });
});

function noticeJob(dispatchId: string) {
  return {
    name: EMAIL_JOB_INVESTITURE_NOTICE,
    data: { dispatchId },
  } as never;
}

function noticeProcessor(
  service: InvestitureCommunicationsService,
  send: (payload: {
    to: string;
    idempotencyKey?: string;
  }) => Promise<{ messageId: string }>,
) {
  const processor = new EmailProcessor(
    { send },
    { get: () => 'https://admin.example.test' } as never,
    {} as never,
    { get: () => service } as never,
  );
  (
    processor as unknown as {
      renderTemplate: (
        name: string,
        data: { subject?: string; paragraphs?: string[] },
      ) => Promise<{ subject: string; html: string; text: string }>;
    }
  ).renderTemplate = async (_name, data) => ({
    subject: data.subject ?? 'Aviso',
    html: JSON.stringify(data.paragraphs ?? []),
    text: JSON.stringify(data.paragraphs ?? []),
  });
  return processor;
}

async function lostAck(now: Date) {
  const { prisma, state, dispatches } = world();
  state.includeOfficer = false;
  state.extraPastor = false;
  const jobs: Array<{ dispatchId: string }> = [];
  const service = serviceOf(prisma, {
    sendInvestitureNotice: async ({ dispatchId }) => {
      jobs.push({ dispatchId });
    },
  });
  const bodies = new Map<string, string>();
  let calls = 0;
  const processor = noticeProcessor(service, async (payload) => {
    calls += 1;
    const key = payload.idempotencyKey ?? '';
    const body = JSON.stringify(payload);
    const prior = bodies.get(key);
    if (prior && prior !== body) {
      throw new Error('invalid_idempotent_request');
    }
    bodies.set(key, body);
    return { messageId: 'accepted' };
  });
  let failAck = true;
  const acknowledge = service.acknowledge.bind(service);
  service.acknowledge = async (dispatchId, messageId) => {
    if (failAck) {
      failAck = false;
      throw new Error('ack lost');
    }
    await acknowledge(dispatchId, messageId);
  };
  expect(await service.dispatchReminders(now)).toBe(1);
  const dispatchId = jobs[0].dispatchId;
  await expect(processor.process(noticeJob(dispatchId))).rejects.toThrow(
    /ack lost/,
  );
  const row = dispatches.find((item) => item.dispatch_id === dispatchId);
  if (!row) {
    throw new Error('missing dispatch');
  }
  return {
    state,
    processor,
    dispatchId,
    bodies,
    row,
    get calls() {
      return calls;
    },
  };
}

describe('BC-1 and BC-7 delivery', () => {
  const row = {
    kind: 'PRESENTATION' as const,
    execution_key: 'bc1',
    recipient_user_id: PASTOR,
    role: 'pastor',
    scope_key: 'district:4',
    attempts: 1,
    lease_until: null,
    claim_token: null,
    sent_at: null,
    last_error: null,
  };

  async function race(
    id: string,
    status: 'sending' | 'queued',
    next: 'sent' | 'sending',
  ) {
    const previousInvestiture = process.env.INVESTITURE_EMAIL_ENABLED;
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.INVESTITURE_EMAIL_ENABLED = 'false';
    process.env.EMAIL_ENABLED = 'true';
    try {
      const { prisma, dispatches } = world();
      const service = serviceOf(prisma, {
        sendInvestitureNotice: async () => undefined,
      });
      dispatches.push({
        ...row,
        dispatch_id: id,
        status,
        payload: {},
      });
      const findMany = prisma.investiture_message_dispatches.findMany;
      let raced = false;
      prisma.investiture_message_dispatches.findMany = async (args) => {
        const rows = await findMany(args);
        if (!raced && rows.some((item) => item.dispatch_id === id)) {
          raced = true;
          const snapshot = rows.map((item) => ({
            ...item,
            payload: { ...(item.payload as object) },
          }));
          const live = dispatches.find((item) => item.dispatch_id === id);
          if (live) {
            live.status = next;
            live.payload = {
              providerAttempt: {
                at: new Date().toISOString(),
                body: 'accepted',
              },
            };
            if (next === 'sent') {
              live.sent_at = new Date();
            }
          }
          return snapshot;
        }
        return rows;
      };
      await service.deliverPending();
      return dispatches.find((item) => item.dispatch_id === id);
    } finally {
      if (previousInvestiture === undefined) {
        delete process.env.INVESTITURE_EMAIL_ENABLED;
      } else {
        process.env.INVESTITURE_EMAIL_ENABLED = previousInvestiture;
      }
      if (previousEmail === undefined) {
        delete process.env.EMAIL_ENABLED;
      } else {
        process.env.EMAIL_ENABLED = previousEmail;
      }
    }
  }

  it('BC-1 does not skip a row that became sent', async () => {
    const stored = await race('bc1-sent', 'sending', 'sent');
    expect(stored?.status).toBe('sent');
    expect(stored?.last_error).not.toBe('investiture_email_disabled');
  });

  it('BC-1 marks uncertain when an attempt appears before the skip', async () => {
    const stored = await race('bc1-attempt', 'queued', 'sending');
    expect(stored?.status).toBe('uncertain');
  });

  it('BC-7 does not send the same reminder twice or on the next day', async () => {
    const previousInvestiture = process.env.INVESTITURE_EMAIL_ENABLED;
    const previousEmail = process.env.EMAIL_ENABLED;
    process.env.INVESTITURE_EMAIL_ENABLED = 'true';
    process.env.EMAIL_ENABLED = 'true';
    const { prisma, dispatches } = world();
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    expect(
      await service.dispatchReminders(new Date('2026-10-05T19:00:00.000Z')),
    ).toBeGreaterThan(0);
    const first = dispatches.filter((item) => item.kind === 'REMINDER').length;
    expect(
      await service.dispatchReminders(new Date('2026-10-05T20:00:00.000Z')),
    ).toBe(0);
    expect(dispatches.filter((item) => item.kind === 'REMINDER')).toHaveLength(
      first,
    );
    expect(
      await service.dispatchReminders(new Date('2026-10-06T19:00:00.000Z')),
    ).toBe(0);
    if (previousInvestiture === undefined) {
      delete process.env.INVESTITURE_EMAIL_ENABLED;
    } else {
      process.env.INVESTITURE_EMAIL_ENABLED = previousInvestiture;
    }
    if (previousEmail === undefined) {
      delete process.env.EMAIL_ENABLED;
    } else {
      process.env.EMAIL_ENABLED = previousEmail;
    }
  });
});

describe('BCR-6 pastor eligibility in mails', () => {
  const monday = new Date('2026-10-05T16:00:00.000Z');
  const previousInvestitureEmail = process.env.INVESTITURE_EMAIL_ENABLED;
  const previousGlobalEmail = process.env.EMAIL_ENABLED;

  beforeEach(() => {
    process.env.INVESTITURE_EMAIL_ENABLED = 'true';
    process.env.EMAIL_ENABLED = 'true';
  });

  afterAll(() => {
    if (previousInvestitureEmail === undefined) {
      delete process.env.INVESTITURE_EMAIL_ENABLED;
    } else {
      process.env.INVESTITURE_EMAIL_ENABLED = previousInvestitureEmail;
    }
    if (previousGlobalEmail === undefined) {
      delete process.env.EMAIL_ENABLED;
    } else {
      process.env.EMAIL_ENABLED = previousGlobalEmail;
    }
  });

  const recipients = (
    rows: Array<{ kind: string; role: string; recipient_user_id: string }>,
    kind: string,
  ) =>
    rows
      .filter((row) => row.kind === kind && row.role === 'pastor')
      .map((row) => row.recipient_user_id);

  it('does not mail a deleted account or an account without the pastor role', async () => {
    const { prisma, state, dispatches } = world();
    state.includeOfficer = false;
    state.deletedAccounts.add(PASTOR);
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    await service.recordPresentation({
      requestId: REQUEST,
      enrollmentIds: [1],
    });
    expect(recipients(dispatches, 'PRESENTATION')).toEqual([OTHER_PASTOR]);
    await service.dispatchReminders(monday);
    expect(recipients(dispatches, 'REMINDER')).toEqual([OTHER_PASTOR]);

    const second = world();
    second.state.includeOfficer = false;
    second.state.rolelessUsers.add(OTHER_PASTOR);
    const other = serviceOf(second.prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    await other.recordPresentation({ requestId: REQUEST, enrollmentIds: [1] });
    await other.dispatchReminders(monday);
    expect(recipients(second.dispatches, 'PRESENTATION')).toEqual([PASTOR]);
    expect(recipients(second.dispatches, 'REMINDER')).toEqual([PASTOR]);
  });

  it('stops a frozen reminder when the pastor account is deleted afterwards', async () => {
    const { prisma, state, dispatches } = world();
    state.includeOfficer = false;
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    await service.dispatchReminders(monday);
    const row = dispatches.find(
      (item) => item.kind === 'REMINDER' && item.recipient_user_id === PASTOR,
    );
    expect(row).toBeDefined();
    state.deletedAccounts.add(PASTOR);
    expect(await service.prepare(row?.dispatch_id ?? '')).toBeNull();
    expect(row?.status).toBe('skipped');
  });
});

describe('BCR-3 reminder retry cap', () => {
  const monday10 = new Date('2026-10-05T16:00:00.000Z');
  const previousInvestitureEmail = process.env.INVESTITURE_EMAIL_ENABLED;
  const previousGlobalEmail = process.env.EMAIL_ENABLED;

  beforeEach(() => {
    process.env.INVESTITURE_EMAIL_ENABLED = 'true';
    process.env.EMAIL_ENABLED = 'true';
  });

  afterAll(() => {
    if (previousInvestitureEmail === undefined) {
      delete process.env.INVESTITURE_EMAIL_ENABLED;
    } else {
      process.env.INVESTITURE_EMAIL_ENABLED = previousInvestitureEmail;
    }
    if (previousGlobalEmail === undefined) {
      delete process.env.EMAIL_ENABLED;
    } else {
      process.env.EMAIL_ENABLED = previousGlobalEmail;
    }
  });

  it('counts every re-queue of a failed job: exactly 5 attempts, then skipped with the cap cause (bc-reminder-retry-cap-probe Q1)', async () => {
    const { prisma, dispatches } = world();
    dispatches.push({
      dispatch_id: 'bc-q1',
      kind: 'REMINDER',
      execution_key: '2026-10-05',
      recipient_user_id: '00000000-0000-4000-8000-0000000000b2',
      role: 'pastor',
      scope_key: 'field:10',
      status: 'queued',
      attempts: 1,
      payload: { channel: 'email', requestIds: [] },
      lease_until: null,
      claim_token: null,
      sent_at: null,
      last_error: null,
    });
    let requeues = 0;
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
      inspectInvestitureJob: async () => 'failed',
      retryFailedInvestitureJob: async () => {
        requeues += 1;
      },
    });
    for (let run = 0; run < 20; run += 1) {
      await service.deliverPending(
        new Date(monday10.getTime() + run * 15 * 60 * 1000),
      );
    }
    const row = dispatches.find((item) => item.dispatch_id === 'bc-q1');
    expect({ requeues, attempts: row?.attempts, status: row?.status }).toEqual({
      requeues: 4,
      attempts: 5,
      status: 'skipped',
    });
    expect(row?.last_error).toBe('reminder_retry_limit');
  });

  it('reaches the provider exactly 5 times when the worker fails every claim (probe Q2)', async () => {
    const { prisma, dispatches } = world();
    let providerAttempts = 0;
    const holder: { service?: ReturnType<typeof serviceOf> } = {};
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async ({ dispatchId }) => {
        const fresh = await holder.service?.prepare(dispatchId);
        if (fresh) {
          providerAttempts += 1;
          await holder.service?.markFailed(dispatchId, 'provider down');
        }
      },
      inspectInvestitureJob: async () => 'missing',
    });
    holder.service = service;
    service.bindClock(() => monday10);
    await service.dispatchReminders(monday10);
    for (let run = 1; run < 20; run += 1) {
      const now = new Date(monday10.getTime() + run * 15 * 60 * 1000);
      service.bindClock(() => now);
      await service.deliverPending(now);
    }
    const pastor = dispatches.find(
      (item) => item.kind === 'REMINDER' && item.role === 'pastor',
    );
    expect({
      providerAttempts: providerAttempts / 3,
      pastorAttempts: pastor?.attempts,
      status: pastor?.status,
    }).toEqual({ providerAttempts: 5, pastorAttempts: 5, status: 'skipped' });
    expect(pastor?.last_error).toBe('reminder_retry_limit');
  });

  it('counts a re-queue of a missing job for a queued row', async () => {
    const { prisma, dispatches } = world();
    dispatches.push({
      dispatch_id: 'bc-q3',
      kind: 'REMINDER',
      execution_key: '2026-10-05',
      recipient_user_id: PASTOR,
      role: 'pastor',
      scope_key: 'field:10',
      status: 'queued',
      attempts: 4,
      payload: { channel: 'email', requestIds: [REQUEST] },
      lease_until: null,
      claim_token: null,
      sent_at: null,
      last_error: null,
    });
    const sent: string[] = [];
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async ({ dispatchId }) => {
        sent.push(dispatchId);
      },
      inspectInvestitureJob: async () => 'missing',
    });
    await service.deliverPending(monday10);
    expect(sent).toEqual(['bc-q3']);
    expect(
      dispatches.find((item) => item.dispatch_id === 'bc-q3')?.attempts,
    ).toBe(5);
    await service.deliverPending(new Date(monday10.getTime() + 15 * 60 * 1000));
    expect(sent).toEqual(['bc-q3']);
    expect(
      dispatches.find((item) => item.dispatch_id === 'bc-q3'),
    ).toMatchObject({
      status: 'skipped',
      last_error: 'reminder_retry_limit',
    });
  });
});

describe('BCR-5 reminder day ledger', () => {
  const at = (day: string, localHour: number) =>
    new Date(`${day}T${String(localHour + 6).padStart(2, '0')}:00:00.000Z`);
  const previousInvestitureEmail = process.env.INVESTITURE_EMAIL_ENABLED;
  const previousGlobalEmail = process.env.EMAIL_ENABLED;

  beforeEach(() => {
    process.env.INVESTITURE_EMAIL_ENABLED = 'true';
    process.env.EMAIL_ENABLED = 'true';
  });

  afterAll(() => {
    if (previousInvestitureEmail === undefined) {
      delete process.env.INVESTITURE_EMAIL_ENABLED;
    } else {
      process.env.INVESTITURE_EMAIL_ENABLED = previousInvestitureEmail;
    }
    if (previousGlobalEmail === undefined) {
      delete process.env.EMAIL_ENABLED;
    } else {
      process.env.EMAIL_ENABLED = previousGlobalEmail;
    }
  });

  const reminders = (rows: Array<{ kind: string }>) =>
    rows.filter((row) => row.kind === 'REMINDER');

  it('(a) 10:00 run done with no pendings, a new pending at 15:00 sends nothing that day', async () => {
    const { prisma, state, dispatches } = world();
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    state.pending = false;
    expect(await service.dispatchReminders(at('2026-10-05', 10))).toBe(0);
    state.pending = true;
    expect(await service.dispatchReminders(at('2026-10-05', 15))).toBe(0);
    expect(reminders(dispatches)).toHaveLength(0);
  });

  it('(b) a missed 10:00 run is recovered once by the 13:00 run and not by the 14:00 run', async () => {
    const { prisma, dispatches } = world();
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    expect(
      await service.dispatchReminders(at('2026-10-05', 13)),
    ).toBeGreaterThan(0);
    const first = reminders(dispatches).length;
    expect(first).toBeGreaterThan(0);
    expect(await service.dispatchReminders(at('2026-10-05', 14))).toBe(0);
    expect(reminders(dispatches)).toHaveLength(first);
  });

  it('(c) a non-scheduled day sends nothing, and the missed Monday is not recovered on Tuesday', async () => {
    const { prisma, dispatches, ledger } = world();
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    expect(await service.dispatchReminders(at('2026-10-06', 11))).toBe(0);
    expect(await service.dispatchReminders(at('2026-10-08', 15))).toBe(0);
    expect(reminders(dispatches)).toHaveLength(0);
    expect(ledger.size).toBe(0);
  });

  it('does not consume the day while investiture email is switched off', async () => {
    const { prisma, dispatches, ledger } = world();
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async () => undefined,
    });
    process.env.INVESTITURE_EMAIL_ENABLED = 'false';
    expect(await service.dispatchReminders(at('2026-10-05', 10))).toBe(0);
    expect(ledger.size).toBe(0);
    process.env.INVESTITURE_EMAIL_ENABLED = 'true';
    expect(
      await service.dispatchReminders(at('2026-10-05', 13)),
    ).toBeGreaterThan(0);
    expect(reminders(dispatches).length).toBeGreaterThan(0);
  });

  it('BCR33-N2 a render error does not consume the day: a later run recovers it once', async () => {
    const { prisma, dispatches, ledger } = world();
    // Only this scenario needs the claim release; the shared mock stays
    // without $executeRaw (other scenarios rely on that).
    (prisma as unknown as { $executeRaw: unknown }).$executeRaw = async (
      sql: unknown,
    ) => {
      const [ids, roles, dates] = (sql as { values: unknown[] }).values as [
        number[],
        string[],
        string[],
      ];
      let count = 0;
      ids.forEach((id, index) => {
        if (ledger.delete(`${id}:${roles[index]}:${dates[index]}`)) {
          count += 1;
        }
      });
      return count;
    };
    let panel = '';
    const service = new InvestitureCommunicationsService(
      prisma as never,
      { sendInvestitureNotice: async () => undefined } as never,
      { pushBestEffort: async () => undefined } as never,
      { get: () => panel } as never,
    );
    service.bindClock(() => at('2026-10-05', 10));
    expect(await service.dispatchReminders(at('2026-10-05', 10))).toBe(0);
    expect(reminders(dispatches)).toHaveLength(0);
    expect(ledger.size).toBe(0);
    panel = 'https://admin.example.test';
    const recovered = await service.dispatchReminders(at('2026-10-05', 11));
    expect(recovered).toBeGreaterThan(0);
    const created = reminders(dispatches).length;
    expect(created).toBeGreaterThan(0);
    expect(ledger.size).toBeGreaterThan(0);
    expect(await service.dispatchReminders(at('2026-10-05', 12))).toBe(0);
    expect(reminders(dispatches)).toHaveLength(created);
  });

  it('BCR33-N4 tells the email port the kind so reminders are a single provider attempt', async () => {
    const { prisma } = world();
    const kinds: Array<string | undefined> = [];
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async ({ kind }) => {
        kinds.push(kind);
      },
    });
    await service.dispatchReminders(at('2026-10-05', 10));
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((kind) => kind === 'REMINDER')).toBe(true);
  });

  it('keeps the claimed day after a queue failure and lets deliverPending finish it', async () => {
    const { prisma, dispatches } = world();
    let down = true;
    const sent: string[] = [];
    const service = serviceOf(prisma, {
      sendInvestitureNotice: async ({ dispatchId }) => {
        if (down) {
          throw new Error('queue down');
        }
        sent.push(dispatchId);
      },
    });
    const monday = at('2026-10-05', 10);
    expect(await service.dispatchReminders(monday)).toBe(0);
    const created = reminders(dispatches).length;
    expect(created).toBeGreaterThan(0);
    down = false;
    expect(await service.dispatchReminders(at('2026-10-05', 11))).toBe(0);
    expect(sent).toEqual([]);
    expect(await service.deliverPending(monday)).toBeGreaterThan(0);
    expect(sent).toHaveLength(created);
    expect(reminders(dispatches)).toHaveLength(created);
  });
});
