import { ErrorCode } from '../common/errors/error-codes';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import { LocalFieldTimezoneResolver } from '../common/authorization/local-field-timezone.resolver';
import { FieldClassThresholdConfigService } from './field-class-threshold-config.service';

const YEAR_ID = 2026;
const FIELD_ID = 10;

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
            : {
                local_field: { id: options.localFieldId, name: 'Campo' },
              }),
        },
        club: null,
      },
    },
  };
}

describe('FieldClassThresholdConfigService', () => {
  const field = {
    local_field_id: FIELD_ID,
    timezone: 'America/Mexico_City',
    union_id: 2,
    unions: { division_id: 1 },
  };
  const year = {
    year_id: YEAR_ID,
    start_date: new Date('2025-09-01T00:00:00.000Z'),
    end_date: new Date('2026-08-31T00:00:00.000Z'),
  };

  let thresholds: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  let prisma: {
    local_fields: { findUnique: jest.Mock };
    ecclesiastical_years: { findUnique: jest.Mock };
    local_field_class_thresholds: typeof thresholds;
  };
  let service: FieldClassThresholdConfigService;

  beforeEach(() => {
    thresholds = {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create }) =>
        Promise.resolve({
          ...create,
          minimum_percent: create.minimum_percent,
        }),
      ),
    };
    prisma = {
      local_fields: { findUnique: jest.fn().mockResolvedValue(field) },
      ecclesiastical_years: { findUnique: jest.fn().mockResolvedValue(year) },
      local_field_class_thresholds: thresholds,
    };
    service = new FieldClassThresholdConfigService(
      prisma as never,
      new LocalFieldTimezoneResolver({} as never),
      { now: () => new Date('2026-06-15T18:00:00.000Z') },
    );
  });

  it('reads 80 when the field has no row and does not create one', async () => {
    const view = await service.get(
      snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
      FIELD_ID,
      YEAR_ID,
    );

    expect(view).toMatchObject({
      local_field_id: FIELD_ID,
      ecclesiastical_year_id: YEAR_ID,
      minimum_percent: 80,
      configured: false,
      can_edit: true,
    });
    expect(thresholds.upsert).not.toHaveBeenCalled();
  });

  it('lets the field director store 90 until 30 June 23:59 local', async () => {
    const view = await service.update(
      snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
      FIELD_ID,
      YEAR_ID,
      90,
      'user-1',
      new Date('2026-07-01T05:59:00.000Z'),
    );

    expect(view.minimum_percent).toBe(90);
    expect(view.configured).toBe(true);
    expect(thresholds.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          local_field_id: FIELD_ID,
          ecclesiastical_year_id: YEAR_ID,
          minimum_percent: 90,
          updated_by_id: 'user-1',
        }),
        update: expect.objectContaining({
          minimum_percent: 90,
          updated_by_id: 'user-1',
        }),
      }),
    );
  });

  it('lets the assistant of the same field store the percent', async () => {
    const view = await service.update(
      snapshot({ role: 'assistant-lf', localFieldId: FIELD_ID }),
      FIELD_ID,
      YEAR_ID,
      85,
      'user-2',
    );

    expect(view.minimum_percent).toBe(85);
  });

  it('rejects a director of another field before reading the threshold', async () => {
    await expect(
      service.get(
        snapshot({ role: 'director-lf', localFieldId: 99 }),
        FIELD_ID,
        YEAR_ID,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    expect(thresholds.findUnique).not.toHaveBeenCalled();
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
      service.update(actor, 99, YEAR_ID, 90, 'user-1'),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });

    const view = await service.update(actor, FIELD_ID, YEAR_ID, 90, 'user-1');
    expect(view.minimum_percent).toBe(90);
    expect(thresholds.upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects admin before reading or writing the threshold', async () => {
    const actor = snapshot({ role: 'admin', localFieldId: FIELD_ID });

    await expect(
      service.update(actor, FIELD_ID, YEAR_ID, 90, 'admin-1'),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    await expect(service.get(actor, FIELD_ID, YEAR_ID)).rejects.toMatchObject({
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });
    expect(thresholds.findUnique).not.toHaveBeenCalled();
    expect(thresholds.upsert).not.toHaveBeenCalled();
  });

  it('rejects a union director on read and write, including a field in the union', async () => {
    const actor = snapshot({
      role: 'director-union',
      unionId: 2,
      localFieldId: 4,
    });

    await expect(
      service.update(actor, FIELD_ID, YEAR_ID, 90, 'union-1'),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    await expect(service.get(actor, FIELD_ID, YEAR_ID)).rejects.toMatchObject({
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });
    expect(thresholds.findUnique).not.toHaveBeenCalled();
    expect(thresholds.upsert).not.toHaveBeenCalled();
  });

  it('rejects a union director who targets a field outside the union', async () => {
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
    expect(thresholds.findUnique).not.toHaveBeenCalled();
  });

  it('rejects the field director at 1 July 00:00 local and still allows super-admin', async () => {
    const afterCutoff = new Date('2026-07-01T06:00:00.000Z');

    await expect(
      service.update(
        snapshot({ role: 'director-lf', localFieldId: FIELD_ID }),
        FIELD_ID,
        YEAR_ID,
        90,
        'user-1',
        afterCutoff,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CLASS_THRESHOLD_EDIT_CLOSED });

    const view = await service.update(
      snapshot({ role: 'super-admin' }),
      FIELD_ID,
      YEAR_ID,
      75,
      'root-1',
      afterCutoff,
    );
    expect(view.minimum_percent).toBe(75);
    expect(view.can_edit).toBe(true);
  });

  it('rejects super-admin outside the ecclesiastical year that contains now', async () => {
    await expect(
      service.update(
        snapshot({ role: 'super-admin' }),
        FIELD_ID,
        YEAR_ID,
        90,
        'root-1',
        new Date('2026-09-01T18:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CLASS_THRESHOLD_EDIT_CLOSED });
    expect(thresholds.upsert).not.toHaveBeenCalled();
  });

  it('rejects a percent outside 0-100 and a non-integer', async () => {
    const actor = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });

    await expect(
      service.update(actor, FIELD_ID, YEAR_ID, 101, 'user-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.CLASS_THRESHOLD_PERCENT_INVALID,
    });
    await expect(
      service.update(actor, FIELD_ID, YEAR_ID, 90.5, 'user-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.CLASS_THRESHOLD_PERCENT_INVALID,
    });
    expect(thresholds.upsert).not.toHaveBeenCalled();
  });

  it('rejects a club director with no territorial role', async () => {
    await expect(
      service.get(snapshot({ role: 'director' }), FIELD_ID, YEAR_ID),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    expect(thresholds.findUnique).not.toHaveBeenCalled();
  });

  it('returns not found when the field or the year does not exist', async () => {
    const actor = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });
    prisma.local_fields.findUnique.mockResolvedValue(null);

    await expect(service.get(actor, FIELD_ID, YEAR_ID)).rejects.toMatchObject({
      code: ErrorCode.CLASS_THRESHOLD_FIELD_NOT_FOUND,
    });

    prisma.local_fields.findUnique.mockResolvedValue(field);
    prisma.ecclesiastical_years.findUnique.mockResolvedValue(null);
    await expect(service.get(actor, FIELD_ID, YEAR_ID)).rejects.toMatchObject({
      code: ErrorCode.CLASS_THRESHOLD_YEAR_NOT_FOUND,
    });
  });

  it('accepts 0 and 100', async () => {
    const actor = snapshot({ role: 'director-lf', localFieldId: FIELD_ID });

    await expect(
      service.update(actor, FIELD_ID, YEAR_ID, 0, 'user-1'),
    ).resolves.toMatchObject({ minimum_percent: 0 });
    await expect(
      service.update(actor, FIELD_ID, YEAR_ID, 100, 'user-1'),
    ).resolves.toMatchObject({ minimum_percent: 100 });
  });
});
