import { ErrorCode } from '../common/errors/error-codes';
import { LocalFieldTimezoneResolver } from '../common/authorization/local-field-timezone.resolver';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import { FieldClassThresholdConfigService } from './field-class-threshold-config.service';
import { FieldInvestitureWindowConfigService } from './field-investiture-window-config.service';

const FIELD_ID = 10;
const YEAR_ID = 2026;

function snapshot(options: {
  role: string;
  localFieldId?: number;
  unionId?: number;
  divisionId?: number;
}): AuthorizationSnapshot {
  return {
    grants: {
      global_roles: [{ role_name: options.role, permissions: [], scope: {} }],
      club_assignments: [],
      direct_permissions: [],
    },
    active_assignment: { assignment_id: null },
    effective: {
      permissions: [],
      scope: {
        global: {
          ...(options.divisionId === undefined
            ? {}
            : { division: { id: options.divisionId, name: 'DIA' } }),
          ...(options.unionId === undefined
            ? {}
            : { union: { id: options.unionId, name: 'Unión' } }),
          ...(options.localFieldId === undefined
            ? {}
            : { local_field: { id: options.localFieldId, name: 'Campo' } }),
        },
        club: null,
      },
    },
  };
}

describe('FieldInvestitureWindowConfigService', () => {
  const field = {
    local_field_id: FIELD_ID,
    timezone: 'America/Mexico_City',
    union_id: 2,
    unions: { division_id: 1 },
  };
  const year = {
    year_id: YEAR_ID,
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    end_date: new Date('2026-12-31T00:00:00.000Z'),
    active: true,
  };

  let windows: { findUnique: jest.Mock; upsert: jest.Mock };
  let thresholds: { findUnique: jest.Mock; upsert: jest.Mock };
  let prisma: {
    local_fields: { findUnique: jest.Mock };
    ecclesiastical_years: { findUnique: jest.Mock };
    local_field_investiture_windows: typeof windows;
    local_field_class_thresholds: typeof thresholds;
  };
  let service: FieldInvestitureWindowConfigService;

  beforeEach(() => {
    windows = {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest
        .fn()
        .mockImplementation(({ create }) => Promise.resolve(create)),
    };
    thresholds = {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    };
    prisma = {
      local_fields: { findUnique: jest.fn().mockResolvedValue(field) },
      ecclesiastical_years: { findUnique: jest.fn().mockResolvedValue(year) },
      local_field_investiture_windows: windows,
      local_field_class_thresholds: thresholds,
    };
    service = new FieldInvestitureWindowConfigService(
      prisma as never,
      new LocalFieldTimezoneResolver({} as never),
      { now: () => new Date('2026-10-15T18:00:00.000Z') },
    );
  });

  it('reads the clipped default without inserting a row', async () => {
    const view = await service.get(
      snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
      FIELD_ID,
      YEAR_ID,
    );

    expect(view).toEqual({
      local_field_id: FIELD_ID,
      ecclesiastical_year_id: YEAR_ID,
      start_date: '2026-10-01',
      end_date: '2026-12-20',
      configured: false,
      operational: true,
      can_edit: true,
    });
    expect(windows.upsert).not.toHaveBeenCalled();
  });

  it('lets the field director store dates inside the year, including a one-day window', async () => {
    const view = await service.update(
      snapshot({ role: 'assistant-lf', localFieldId: FIELD_ID }),
      FIELD_ID,
      YEAR_ID,
      { start_date: '2026-11-01', end_date: '2026-11-01' },
      'user-1',
    );

    expect(view).toMatchObject({
      start_date: '2026-11-01',
      end_date: '2026-11-01',
      configured: true,
      can_edit: true,
    });
    expect(Object.keys(view).sort()).toEqual([
      'can_edit',
      'configured',
      'ecclesiastical_year_id',
      'end_date',
      'local_field_id',
      'operational',
      'start_date',
    ]);
    expect(windows.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          local_field_id: FIELD_ID,
          ecclesiastical_year_id: YEAR_ID,
          updated_by_id: 'user-1',
        }),
      }),
    );
    expect(thresholds.upsert).not.toHaveBeenCalled();
  });

  it('lets admin edit a field inside the union and rejects one outside it', async () => {
    const actor = snapshot({ role: 'admin', unionId: 2 });
    const view = await service.update(
      actor,
      FIELD_ID,
      YEAR_ID,
      { start_date: '2026-10-01', end_date: '2026-12-10' },
      'admin-1',
    );
    expect(view.can_edit).toBe(true);

    prisma.local_fields.findUnique.mockResolvedValue({
      ...field,
      union_id: 8,
    });
    windows.findUnique.mockClear();
    await expect(service.get(actor, FIELD_ID, YEAR_ID)).rejects.toMatchObject({
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });
    expect(windows.findUnique).not.toHaveBeenCalled();
  });

  it('does not grant class-threshold edit to an admin who saved the window', async () => {
    const actor = snapshot({ role: 'admin', localFieldId: FIELD_ID });
    await service.update(
      actor,
      FIELD_ID,
      YEAR_ID,
      { start_date: '2026-10-01', end_date: '2026-12-20' },
      'admin-1',
    );

    const thresholdsService = new FieldClassThresholdConfigService(
      prisma as never,
      new LocalFieldTimezoneResolver({} as never),
      { now: () => new Date('2026-10-15T18:00:00.000Z') },
    );
    await expect(
      thresholdsService.update(actor, FIELD_ID, YEAR_ID, 90, 'admin-1'),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    expect(thresholds.upsert).not.toHaveBeenCalled();
  });

  it('lets a union director read a field in the union and rejects the write', async () => {
    const actor = snapshot({ role: 'director-union', unionId: 2 });
    const view = await service.get(actor, FIELD_ID, YEAR_ID);
    expect(view.can_edit).toBe(false);
    expect(view.start_date).toBe('2026-10-01');

    await expect(
      service.update(
        actor,
        FIELD_ID,
        YEAR_ID,
        { start_date: '2026-10-01', end_date: '2026-12-01' },
        'union-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    expect(windows.upsert).not.toHaveBeenCalled();
  });

  it('rejects a union director who targets a field outside the union before reading the window', async () => {
    prisma.local_fields.findUnique.mockResolvedValue({
      ...field,
      union_id: 8,
    });

    await expect(
      service.get(
        snapshot({ role: 'director-union', unionId: 2 }),
        FIELD_ID,
        YEAR_ID,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    expect(windows.findUnique).not.toHaveBeenCalled();
  });

  it('lets a division director read and not edit', async () => {
    const actor = snapshot({ role: 'director-dia', divisionId: 1 });
    const view = await service.get(actor, FIELD_ID, YEAR_ID);
    expect(view.can_edit).toBe(false);

    await expect(
      service.update(
        actor,
        FIELD_ID,
        YEAR_ID,
        { start_date: '2026-10-02', end_date: '2026-12-02' },
        'dia-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
  });

  it('rejects a field director of another field before reading the window', async () => {
    await expect(
      service.get(
        snapshot({ role: 'director-lf', localFieldId: 99 }),
        FIELD_ID,
        YEAR_ID,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    expect(windows.findUnique).not.toHaveBeenCalled();
    expect(prisma.local_fields.findUnique).not.toHaveBeenCalled();
  });

  it('rejects dates outside the year and a start after the end', async () => {
    const actor = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });

    await expect(
      service.update(
        actor,
        FIELD_ID,
        YEAR_ID,
        { start_date: '2025-10-01', end_date: '2026-12-20' },
        'user-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_WINDOW_OUTSIDE_YEAR,
    });
    await expect(
      service.update(
        actor,
        FIELD_ID,
        YEAR_ID,
        { start_date: '2026-12-20', end_date: '2026-10-01' },
        'user-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_WINDOW_START_AFTER_END,
    });
    await expect(
      service.update(
        actor,
        FIELD_ID,
        YEAR_ID,
        { start_date: '2026-02-31', end_date: '2026-12-20' },
        'user-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_WINDOW_DATE_INVALID,
    });
    expect(windows.upsert).not.toHaveBeenCalled();
  });

  it('rejects edits when the local day is outside the year, including super-admin', async () => {
    await expect(
      service.update(
        snapshot({ role: 'super-admin' }),
        FIELD_ID,
        YEAR_ID,
        { start_date: '2026-10-01', end_date: '2026-12-20' },
        'root-1',
        new Date('2027-01-01T18:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_WINDOW_EDIT_CLOSED,
    });
    expect(windows.upsert).not.toHaveBeenCalled();
  });

  it('rejects edits when the year is inactive and still returns the window on read', async () => {
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      ...year,
      active: false,
    });
    const actor = snapshot({ role: 'super-admin' });

    const view = await service.get(actor, FIELD_ID, YEAR_ID);
    expect(view.can_edit).toBe(false);
    expect(view.start_date).toBe('2026-10-01');

    await expect(
      service.update(
        actor,
        FIELD_ID,
        YEAR_ID,
        { start_date: '2026-10-01', end_date: '2026-12-20' },
        'root-1',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_WINDOW_EDIT_CLOSED,
    });
  });

  it('keeps a field director who also has a union role inside their own field', async () => {
    const actor = snapshot({
      role: 'director-union',
      unionId: 2,
      localFieldId: FIELD_ID,
    });
    actor.grants.global_roles.push({
      role_name: 'director-lf',
      permissions: [],
      scope: {},
    });

    await expect(
      service.update(
        actor,
        99,
        YEAR_ID,
        { start_date: '2026-10-01', end_date: '2026-12-20' },
        'user-1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });

    const own = await service.update(
      actor,
      FIELD_ID,
      YEAR_ID,
      { start_date: '2026-10-05', end_date: '2026-12-05' },
      'user-1',
    );
    expect(own.start_date).toBe('2026-10-05');
    expect(windows.upsert).toHaveBeenCalledTimes(1);
  });

  it('uses one predicate to block present, add and authorize outside the inclusive window', async () => {
    windows.findUnique.mockResolvedValue({
      start_date: new Date('2026-10-01T00:00:00.000Z'),
      end_date: new Date('2026-12-20T00:00:00.000Z'),
    });
    const before = new Date('2026-10-01T05:59:00.000Z');
    const firstDay = new Date('2026-10-01T06:00:00.000Z');
    const lastDay = new Date('2026-12-21T05:59:00.000Z');
    const after = new Date('2026-12-21T06:00:00.000Z');

    await expect(
      service.allowsOperation(FIELD_ID, YEAR_ID, before),
    ).resolves.toBe(false);
    await expect(
      service.allowsOperation(FIELD_ID, YEAR_ID, firstDay),
    ).resolves.toBe(true);
    await expect(
      service.allowsOperation(FIELD_ID, YEAR_ID, lastDay),
    ).resolves.toBe(true);
    await expect(
      service.allowsOperation(FIELD_ID, YEAR_ID, after),
    ).resolves.toBe(false);
  });

  it('stays closed on read when October–December misses the year and nobody saved a valid range', async () => {
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      ...year,
      end_date: new Date('2026-06-30T00:00:00.000Z'),
    });
    const closed = new FieldInvestitureWindowConfigService(
      prisma as never,
      new LocalFieldTimezoneResolver({} as never),
      { now: () => new Date('2026-02-15T18:00:00.000Z') },
    );
    const actor = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });

    const view = await closed.get(actor, FIELD_ID, YEAR_ID);

    expect(view).toEqual({
      local_field_id: FIELD_ID,
      ecclesiastical_year_id: YEAR_ID,
      start_date: null,
      end_date: null,
      configured: false,
      operational: false,
      can_edit: true,
    });
    expect(windows.upsert).not.toHaveBeenCalled();
    await expect(closed.allowsOperation(FIELD_ID, YEAR_ID)).resolves.toBe(
      false,
    );
  });

  it('ignores an invalid stored range and does not rewrite it', async () => {
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      ...year,
      end_date: new Date('2026-06-30T00:00:00.000Z'),
    });
    windows.findUnique.mockResolvedValue({
      start_date: new Date('2026-08-01T00:00:00.000Z'),
      end_date: new Date('2026-08-20T00:00:00.000Z'),
    });

    const view = await service.get(
      snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
      FIELD_ID,
      YEAR_ID,
    );

    expect(view).toMatchObject({
      start_date: null,
      end_date: null,
      configured: false,
      operational: false,
    });
    expect(windows.upsert).not.toHaveBeenCalled();
  });

  it('opens only the saved range after an authorized editor configures a year without a default', async () => {
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      ...year,
      end_date: new Date('2026-06-30T00:00:00.000Z'),
    });
    const closed = new FieldInvestitureWindowConfigService(
      prisma as never,
      new LocalFieldTimezoneResolver({} as never),
      { now: () => new Date('2026-02-15T18:00:00.000Z') },
    );
    const actor = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });

    const saved = await closed.update(
      actor,
      FIELD_ID,
      YEAR_ID,
      { start_date: '2026-02-01', end_date: '2026-02-20' },
      'user-1',
    );
    expect(saved).toMatchObject({
      start_date: '2026-02-01',
      end_date: '2026-02-20',
      configured: true,
      operational: true,
    });

    windows.findUnique.mockResolvedValue({
      start_date: new Date('2026-02-01T00:00:00.000Z'),
      end_date: new Date('2026-02-20T00:00:00.000Z'),
    });
    await expect(
      closed.allowsOperation(
        FIELD_ID,
        YEAR_ID,
        new Date('2026-02-15T18:00:00.000Z'),
      ),
    ).resolves.toBe(true);
    await expect(
      closed.allowsOperation(
        FIELD_ID,
        YEAR_ID,
        new Date('2026-02-21T18:00:00.000Z'),
      ),
    ).resolves.toBe(false);
    await expect(
      closed.allowsOperation(
        FIELD_ID,
        YEAR_ID,
        new Date('2026-01-15T18:00:00.000Z'),
      ),
    ).resolves.toBe(false);

    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      ...year,
      end_date: new Date('2026-06-30T00:00:00.000Z'),
      active: false,
    });
    await expect(
      closed.allowsOperation(
        FIELD_ID,
        YEAR_ID,
        new Date('2026-02-15T18:00:00.000Z'),
      ),
    ).resolves.toBe(false);
  });
});
