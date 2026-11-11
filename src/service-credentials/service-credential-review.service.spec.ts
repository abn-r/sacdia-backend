import { ZonedBusinessTimeService } from '../common/clock/zoned-business-time.service';
import { ServiceCredentialReviewScopeService } from '../common/authorization/service-credential-review-scope.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { StorageBucketAlias } from '../common/services/file-storage.service';
import { RoleRequirementService } from '../role-requirements/role-requirement.service';
import { ServiceCredentialReviewService } from './service-credential-review.service';
import {
  makeCredential,
  newFakeDb,
  newFakePrisma,
  type FakeAssignment,
  type FakeDb,
} from './service-credentials.testing';

const NOW = new Date('2026-11-10T18:00:00.000Z');
const YEAR = 5;

// People
const U1 = '00000001-0000-4000-8000-000000000001'; // club A (field 1, district 10)
const U2 = '00000002-0000-4000-8000-000000000002'; // club B (field 1, district 11)
const U3 = '00000003-0000-4000-8000-000000000003'; // club C (field 2, district 20)
const U4 = '00000004-0000-4000-8000-000000000004'; // no club assignment
// Reviewers
const LF1 = 'aaaaaaa1-0000-4000-8000-000000000001';
const LF2 = 'aaaaaaa2-0000-4000-8000-000000000002';
const COORD = 'bbbbbbb1-0000-4000-8000-000000000001';
const PASTOR = 'ccccccc1-0000-4000-8000-000000000001';
const PASTOR_OFF = 'ccccccc2-0000-4000-8000-000000000002';
const ADMIN = 'ddddddd1-0000-4000-8000-000000000001';
const SUPER = 'ddddddd2-0000-4000-8000-000000000002';
const DUAL = 'eeeeeee1-0000-4000-8000-000000000001'; // pastor + director-lf

const PERM = 'service_credentials:review';

type Profile = { roles: string[]; localFieldId?: number; noPerm?: boolean };
const PROFILES: Record<string, Profile> = {
  [LF1]: { roles: ['director-lf', 'user'], localFieldId: 1 },
  [LF2]: { roles: ['assistant-lf'], localFieldId: 2 },
  [COORD]: { roles: ['zone-coordinator'] },
  [PASTOR]: { roles: ['pastor'] },
  [PASTOR_OFF]: { roles: ['pastor'] },
  [ADMIN]: { roles: ['admin'], localFieldId: 1 },
  [SUPER]: { roles: ['super-admin'] },
  [DUAL]: { roles: ['pastor', 'director-lf'], localFieldId: 1 },
};

function resolved(userId: string) {
  const profile = PROFILES[userId] ?? { roles: ['user'] };
  return {
    profile: { user_id: userId },
    authorization: {
      grants: {
        global_roles: profile.roles.map((role_name) => ({
          role_name,
          permissions: role_name === 'user' ? [] : [PERM],
        })),
        club_assignments: [],
      },
      effective: {
        scope: {
          global: profile.localFieldId
            ? { local_field: { id: profile.localFieldId } }
            : {},
        },
      },
    },
  };
}

function assignment(
  user_id: string,
  sectionId: number,
  clubId: number,
  localFieldId: number,
  districtId: number,
  overrides: Partial<FakeAssignment> = {},
): FakeAssignment {
  return {
    user_id,
    active: true,
    status: 'active',
    ecclesiastical_year_id: YEAR,
    start_date: new Date('2026-01-01T00:00:00Z'),
    club_section_id: sectionId,
    club_sections: {
      club_section_id: sectionId,
      clubs: {
        club_id: clubId,
        name: `Club ${clubId}`,
        local_field_id: localFieldId,
        districlub_type_id: districtId,
      },
    },
    ...overrides,
  };
}

function setup() {
  const db: FakeDb = newFakeDb();
  db.users = [
    [U1, 'Ana', 'Pérez', 'Gómez'],
    [U2, 'Beto', 'Ruiz', null],
    [U3, 'Carla', 'Soto', null],
    [U4, 'Dani', 'Vega', null],
  ].map(([user_id, name, paternal_last_name, maternal_last_name]) => ({
    user_id: user_id as string,
    name: name as string,
    paternal_last_name: paternal_last_name as string,
    maternal_last_name: maternal_last_name,
    user_image: null,
  }));
  db.assignments = [
    assignment(U1, 101, 1, 1, 10),
    assignment(U2, 102, 2, 1, 11),
    assignment(U3, 103, 3, 2, 20),
    // Reviewers that also sit in a club (for the self-review rule).
    assignment(LF1, 101, 1, 1, 10),
  ];
  db.pastorDistricts.set(PASTOR, [10]);
  db.pastorDistricts.set(PASTOR_OFF, [10]);
  db.pastorDistricts.set(DUAL, [10]);
  db.eligiblePastors.add(PASTOR);
  db.eligiblePastors.add(DUAL);
  // PASTOR_OFF holds the assignment but is not an eligible pastor.

  const prisma = newFakePrisma(db);
  const authorizationContext = {
    resolveUserAuthorization: jest.fn(async (id: string) => resolved(id)),
  };
  const coordination = {
    getEffectiveCoordinatorSectionIds: jest.fn(async (id: string) =>
      id === COORD ? [102] : [],
    ),
  };
  const ecclesiasticalYear = {
    getCurrentYear: jest.fn(async () => ({ year_id: YEAR })),
  };
  const scope = new ServiceCredentialReviewScopeService(
    prisma as never,
    authorizationContext as never,
    coordination as never,
    ecclesiasticalYear as never,
  );
  const storage = {
    getSignedDownloadUrl: jest.fn(
      async (_bucket: StorageBucketAlias, key: string) =>
        `https://signed.example/${key}`,
    ),
  };
  const audit = {
    write: jest.fn(async () => ({ auditLogId: BigInt(1), replayed: false })),
  };
  const notifications = { notifySafe: jest.fn(async () => undefined) };
  const service = new ServiceCredentialReviewService(
    prisma as never,
    scope,
    storage as never,
    audit as never,
    notifications as never,
    { now: () => NOW },
    new ZonedBusinessTimeService(),
  );
  const add = (userId: string, overrides = {}) => {
    const row = makeCredential({ user_id: userId, ...overrides });
    db.credentials.push(row);
    return row;
  };
  return { db, prisma, service, scope, storage, audit, notifications, add };
}

const query = (overrides = {}) => ({ page: 1, limit: 20, ...overrides });

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppException
      ? { code: error.code, status: error.getStatus() }
      : String(error);
  }
  return undefined;
}

const ownersOf = (result: { items: Array<{ user: { user_id: string } }> }) =>
  result.items.map((item) => item.user.user_id).sort();

describe('ServiceCredentialReviewService scope', () => {
  it('Local Field sees its own field only (in and out)', async () => {
    const { service, add } = setup();
    add(U1);
    add(U2);
    add(U3);
    expect(ownersOf(await service.list(LF1, query()))).toEqual([U1, U2]);
    expect(ownersOf(await service.list(LF2, query()))).toEqual([U3]);
  });

  it('a coordinator sees the sections of their assignments only', async () => {
    const { service, add } = setup();
    add(U1);
    add(U2);
    add(U3);
    expect(ownersOf(await service.list(COORD, query()))).toEqual([U2]);
  });

  it('a pastor sees the districts they are assigned to, only while eligible', async () => {
    const { service, add } = setup();
    add(U1);
    add(U2);
    add(U3);
    expect(ownersOf(await service.list(PASTOR, query()))).toEqual([U1]);
    expect(ownersOf(await service.list(PASTOR_OFF, query()))).toEqual([]);
  });

  it('admin and super-admin see everyone, even people without a club', async () => {
    const { service, add } = setup();
    add(U1);
    add(U3);
    add(U4);
    expect(ownersOf(await service.list(ADMIN, query()))).toEqual([U1, U3, U4]);
    expect(ownersOf(await service.list(SUPER, query()))).toEqual([U1, U3, U4]);
  });

  it('a reviewer without any scope sees an empty queue', async () => {
    const { service, add } = setup();
    add(U1);
    const result = await service.list(
      '99999999-0000-4000-8000-000000000009',
      query(),
    );
    expect(result.items).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('only an active assignment of the current year opens the scope', async () => {
    const { service, db, add } = setup();
    add(U1);
    db.assignments = [
      assignment(U1, 101, 1, 1, 10, { status: 'inactive' }),
      assignment(U1, 101, 1, 1, 10, { active: false }),
      assignment(U1, 101, 1, 1, 10, { ecclesiastical_year_id: YEAR - 1 }),
    ];
    expect(ownersOf(await service.list(LF1, query()))).toEqual([]);
    // Admin does not need an assignment.
    expect(ownersOf(await service.list(ADMIN, query()))).toEqual([U1]);
  });

  it('out-of-scope detail, approve and reject are 404', async () => {
    const { service, add } = setup();
    const outside = add(U3);
    const expected = {
      code: ErrorCode.SERVICE_CREDENTIAL_NOT_FOUND,
      status: 404,
    };
    expect(
      await failure(service.getDetail(LF1, outside.credential_id)),
    ).toEqual(expected);
    expect(
      await failure(service.approve(LF1, outside.credential_id, {})),
    ).toEqual(expected);
    expect(
      await failure(
        service.reject(LF1, outside.credential_id, { reason: 'No es legible' }),
      ),
    ).toEqual(expected);
    expect(outside.status).toBe('PENDING_REVIEW');
  });

  it('unconfirmed and withdrawn credentials never reach a reviewer', async () => {
    const { service, add } = setup();
    const draft = add(U1, { upload_status: 'PENDING_UPLOAD' });
    const withdrawn = add(U1, { active: false });
    expect((await service.list(LF1, query())).items).toEqual([]);
    expect(
      await failure(service.getDetail(LF1, draft.credential_id)),
    ).toMatchObject({ status: 404 });
    expect(
      await failure(service.approve(LF1, withdrawn.credential_id, {})),
    ).toMatchObject({ status: 404 });
  });
});

describe('ServiceCredentialReviewService decisions', () => {
  it('approves, stores the reviewer and the role through which scope was granted', async () => {
    const { service, add, audit, notifications } = setup();
    const row = add(U1);

    const result = await service.approve(LF1, row.credential_id, {
      expires_at: '2028-12-31',
    });

    expect(row).toMatchObject({
      status: 'APPROVED',
      reviewed_by_id: LF1,
      reviewer_role: 'director-lf',
      reviewed_at: NOW,
      decision_reason: null,
    });
    expect(row.expires_at?.toISOString().slice(0, 10)).toBe('2028-12-31');
    expect(result).toMatchObject({
      status: 'APPROVED',
      reviewer_role: 'director-lf',
      expires_at: '2028-12-31',
    });
    expect(audit.write).toHaveBeenCalledTimes(1);
    const [, event] = audit.write.mock.calls[0] as unknown as [
      unknown,
      Record<string, any>,
    ];
    expect(event).toMatchObject({
      entityType: 'service_credentials',
      entityId: row.credential_id,
      action: 'SERVICE_CREDENTIAL_APPROVED',
      eventKey: `service-credential:approved:${row.credential_id}`,
      actor: { kind: 'user', userId: LF1, roleName: 'director-lf' },
      target: { userId: U1 },
      before: { status: 'PENDING_REVIEW' },
      after: { status: 'APPROVED', expires_at: '2028-12-31' },
      result: 'succeeded',
    });
    expect(notifications.notifySafe).toHaveBeenCalledWith(
      U1,
      expect.any(String),
      expect.stringContaining('aprobada'),
      expect.objectContaining({
        entity_id: row.credential_id,
        action: 'approved',
      }),
      'service-credentials:reviewed',
    );
  });

  it('rejects with a reason, clears expiry and notifies with the reason', async () => {
    const { service, add, audit, notifications } = setup();
    const row = add(U2);

    await service.reject(COORD, row.credential_id, {
      reason: 'Archivo ilegible',
    });

    expect(row).toMatchObject({
      status: 'REJECTED',
      reviewed_by_id: COORD,
      reviewer_role: 'zone-coordinator',
      decision_reason: 'Archivo ilegible',
      expires_at: null,
    });
    const [, event] = audit.write.mock.calls[0] as unknown as [
      unknown,
      Record<string, any>,
    ];
    expect(event.action).toBe('SERVICE_CREDENTIAL_REJECTED');
    expect(event.after).toMatchObject({
      status: 'REJECTED',
      reason: 'Archivo ilegible',
    });
    expect(notifications.notifySafe).toHaveBeenCalledWith(
      U2,
      expect.any(String),
      expect.stringContaining('Archivo ilegible'),
      expect.objectContaining({ action: 'rejected' }),
      'service-credentials:reviewed',
    );
  });

  it('writes the role of the channel that covers the person', async () => {
    const { service, add } = setup();
    const byPastor = add(U1);
    await service.approve(PASTOR, byPastor.credential_id, {});
    expect(byPastor.reviewer_role).toBe('pastor');

    const byAdmin = add(U3);
    await service.approve(ADMIN, byAdmin.credential_id, {});
    expect(byAdmin.reviewer_role).toBe('admin');

    const bySuper = add(U4);
    await service.approve(SUPER, bySuper.credential_id, {});
    expect(bySuper.reviewer_role).toBe('super-admin');
  });

  it('with several roles the first channel in priority order wins (Local Field before pastor)', async () => {
    const { service, add } = setup();
    const row = add(U1);
    await service.approve(DUAL, row.credential_id, {});
    expect(row.reviewer_role).toBe('director-lf');
  });

  it('nobody reviews their own credential, not even an admin', async () => {
    const { service, add, db } = setup();
    const own = add(LF1);
    const adminOwn = add(ADMIN);
    const expected = {
      code: ErrorCode.SERVICE_CREDENTIAL_SELF_REVIEW,
      status: 403,
    };
    expect(await failure(service.approve(LF1, own.credential_id, {}))).toEqual(
      expected,
    );
    expect(
      await failure(
        service.reject(LF1, own.credential_id, { reason: 'Motivo claro' }),
      ),
    ).toEqual(expected);
    expect(
      await failure(service.approve(ADMIN, adminOwn.credential_id, {})),
    ).toEqual(expected);
    expect(db.credentials.every((c) => c.status === 'PENDING_REVIEW')).toBe(
      true,
    );
    // And their own row never shows up in their queue.
    expect((await service.list(LF1, query())).items).toEqual([]);
  });

  it('answers 409 when it is not pending any more', async () => {
    const { service, add } = setup();
    const approved = add(U1, { status: 'APPROVED' });
    const rejected = add(U1, { status: 'REJECTED' });
    const expected = {
      code: ErrorCode.SERVICE_CREDENTIAL_NOT_PENDING,
      status: 409,
    };
    expect(
      await failure(service.approve(LF1, approved.credential_id, {})),
    ).toEqual(expected);
    expect(
      await failure(
        service.reject(LF1, rejected.credential_id, { reason: 'Otra vez' }),
      ),
    ).toEqual(expected);
  });

  it('a lost race (already decided between read and write) is 409 and writes no audit', async () => {
    const { service, add, prisma, audit, notifications } = setup();
    const row = add(U1);
    prisma.service_credentials.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await failure(service.approve(LF1, row.credential_id, {}))).toEqual({
      code: ErrorCode.SERVICE_CREDENTIAL_NOT_PENDING,
      status: 409,
    });
    expect(audit.write).not.toHaveBeenCalled();
    expect(notifications.notifySafe).not.toHaveBeenCalled();
  });

  it.each([['2026-11-10'], ['2025-01-01'], ['2026-02-30']])(
    'rejects approve with expires_at %s (not a future date)',
    async (expires_at) => {
      const { service, add } = setup();
      const row = add(U1);
      expect(
        await failure(service.approve(LF1, row.credential_id, { expires_at })),
      ).toMatchObject({
        code: ErrorCode.SERVICE_CREDENTIAL_DATE_INVALID,
        status: 400,
      });
      expect(row.status).toBe('PENDING_REVIEW');
    },
  );

  it('a failing audit write rolls the decision back to an error (no notification)', async () => {
    const { service, add, audit, notifications } = setup();
    const row = add(U1);
    audit.write.mockRejectedValueOnce(new Error('audit down'));
    await expect(service.approve(LF1, row.credential_id, {})).rejects.toThrow(
      'audit down',
    );
    expect(notifications.notifySafe).not.toHaveBeenCalled();
  });

  it('after an approval RoleRequirementService reports the requirement as MET', async () => {
    const { service, add, prisma } = setup();
    const row = add(U1);
    const requirements = new RoleRequirementService();
    const db = {
      ...prisma,
      role_requirements: {
        findMany: jest.fn(async () => [
          {
            requirement_type: 'COUNSELOR_TRAINING',
            mode: 'INFO',
            effective_from: null,
            equivalent_certification_id: null,
            roles: { role_name: 'director' },
          },
        ]),
      },
      users_certifications: { findMany: jest.fn(async () => []) },
    };
    const evaluate = async () =>
      (
        await requirements.evaluate(db as never, {
          userIds: [U1],
          roleNames: ['director'],
          clubTypeId: 1,
          today: NOW,
        })
      ).get(U1)?.[0].status;

    expect(await evaluate()).toBe('PENDING_REVIEW');
    await service.approve(LF1, row.credential_id, {});
    expect(await evaluate()).toBe('MET');
  });

  it('a rejection leaves the requirement MISSING', async () => {
    const { service, add, prisma } = setup();
    const row = add(U1);
    await service.reject(LF1, row.credential_id, { reason: 'Sin firma' });
    const requirements = new RoleRequirementService();
    const db = {
      ...prisma,
      role_requirements: {
        findMany: jest.fn(async () => [
          {
            requirement_type: 'COUNSELOR_TRAINING',
            mode: 'INFO',
            effective_from: null,
            equivalent_certification_id: null,
            roles: { role_name: 'director' },
          },
        ]),
      },
      users_certifications: { findMany: jest.fn(async () => []) },
    };
    const result = await requirements.evaluate(db as never, {
      userIds: [U1],
      roleNames: ['director'],
      clubTypeId: 1,
      today: NOW,
    });
    expect(result.get(U1)?.[0].status).toBe('MISSING');
  });
});

describe('ServiceCredentialReviewService reads', () => {
  it('lists pending by default, with counts over the whole scope', async () => {
    const { service, add } = setup();
    add(U1);
    add(U2);
    add(U2, {
      status: 'APPROVED',
      reviewer_role: 'director-lf',
      reviewed_at: NOW,
    });
    add(U1, { status: 'REJECTED' });
    add(U3); // out of scope: not counted

    const result = await service.list(LF1, query());

    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.status === 'PENDING_REVIEW')).toBe(
      true,
    );
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 2,
      counts: { pending: 2, approved: 1, rejected: 1 },
    });

    const approved = await service.list(LF1, query({ status: 'APPROVED' }));
    expect(approved.items).toHaveLength(1);
    expect(approved.items[0]).toMatchObject({
      reviewer_role: 'director-lf',
      reviewed_at: NOW.toISOString(),
    });
    expect(approved.meta.total).toBe(1);
    expect(approved.meta.counts).toEqual(result.meta.counts);
  });

  it('paginates', async () => {
    const { service, add } = setup();
    for (let index = 0; index < 5; index += 1) add(U1);
    const second = await service.list(LF1, query({ page: 2, limit: 2 }));
    expect(second.items).toHaveLength(2);
    expect(second.meta).toMatchObject({ page: 2, limit: 2, total: 5 });
  });

  it('searches by name parts, never by email or phone', async () => {
    const { service, add } = setup();
    add(U1);
    add(U2);
    expect(
      ownersOf(await service.list(LF1, query({ search: 'ana pérez' }))),
    ).toEqual([U1]);
    expect(
      ownersOf(await service.list(LF1, query({ search: 'RUIZ' }))),
    ).toEqual([U2]);
    expect(ownersOf(await service.list(LF1, query({ search: 'zzz' })))).toEqual(
      [],
    );
  });

  it('list items carry the agreed shape, the club name and no contact data or file url', async () => {
    const { service, add } = setup();
    const row = add(U1);
    const result = await service.list(LF1, query());
    const [item] = result.items;
    expect(item).toEqual({
      credential_id: row.credential_id,
      user: { user_id: U1, name: 'Ana Pérez Gómez', photo_url: null },
      club_name: 'Club 1',
      type: 'COUNSELOR_TRAINING',
      completed_at: '2026-05-20',
      status: 'PENDING_REVIEW',
      created_at: row.created_at.toISOString(),
      reviewed_at: null,
      reviewer_role: null,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /email|phone|file_url|object_key/,
    );
  });

  it('pending is oldest first (the queue that waits longest)', async () => {
    const { service, add } = setup();
    const newer = add(U1, { created_at: new Date('2026-09-01T00:00:00Z') });
    const older = add(U2, { created_at: new Date('2026-03-01T00:00:00Z') });
    const result = await service.list(LF1, query());
    expect(result.items.map((i) => i.credential_id)).toEqual([
      older.credential_id,
      newer.credential_id,
    ]);
  });

  it('only the detail carries a 900 s signed file url, mime type and decision data', async () => {
    const { service, add, storage } = setup();
    const row = add(U1, {
      status: 'REJECTED',
      decision_reason: 'Sin firma',
      expires_at: null,
    });

    const detail = await service.getDetail(LF1, row.credential_id);

    expect(detail).toMatchObject({
      credential_id: row.credential_id,
      file_url: `https://signed.example/${row.object_key}`,
      mime_type: 'application/pdf',
      decision_reason: 'Sin firma',
      expires_at: null,
      club_name: 'Club 1',
    });
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(
      StorageBucketAlias.CERTIFICATION_EVIDENCE,
      row.object_key,
      { expiresInSeconds: 900 },
    );
    storage.getSignedDownloadUrl.mockClear();
    await service.list(LF1, query({ status: 'REJECTED' }));
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
  });
});
