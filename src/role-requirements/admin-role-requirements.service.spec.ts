import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AdminRoleRequirementsService } from './admin-role-requirements.service';

const ACTOR = '00000000-0000-4000-8000-0000000000aa';

function row(overrides: Record<string, unknown> = {}) {
  return {
    requirement_id: 1,
    requirement_type: 'COUNSELOR_TRAINING',
    mode: 'INFO',
    effective_from: null,
    equivalent_certification_id: null,
    active: true,
    modified_at: new Date('2026-11-01T00:00:00.000Z'),
    roles: { role_id: 'role-1', role_name: 'director' },
    club_types: null,
    certifications: null,
    ...overrides,
  };
}

function setup(current: ReturnType<typeof row> | null = row()) {
  const prisma = {
    role_requirements: {
      findMany: jest.fn(async () => (current ? [current] : [])),
      findFirst: jest.fn(async () => current),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        ...(current as object),
        ...args.data,
        ...(args.data.equivalent_certification_id
          ? {
              certifications: {
                certification_id: args.data.equivalent_certification_id,
                name: 'Curso de consejeros',
              },
            }
          : {}),
      })),
    },
    certifications: {
      findFirst: jest.fn(
        async (args: { where: { certification_id: number } }) =>
          args.where.certification_id === 7 ? { certification_id: 7 } : null,
      ),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const audit = {
    write: jest.fn(async () => ({ auditLogId: BigInt(1), replayed: false })),
  };
  const service = new AdminRoleRequirementsService(
    prisma as never,
    audit as never,
  );
  return { prisma, audit, service };
}

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppException ? error.code : String(error);
  }
  return undefined;
}

describe('AdminRoleRequirementsService', () => {
  it('lists requirements with role, club type, mode, date and equivalence', async () => {
    const { service } = setup(
      row({
        mode: 'WARN',
        effective_from: new Date('2027-01-01T00:00:00.000Z'),
        club_types: { club_type_id: 2, name: 'Conquistadores' },
        certifications: { certification_id: 7, name: 'Curso de consejeros' },
        equivalent_certification_id: 7,
      }),
    );
    expect(await service.list()).toEqual({
      items: [
        {
          requirement_id: 1,
          role: { role_id: 'role-1', name: 'director' },
          club_type: { club_type_id: 2, name: 'Conquistadores' },
          requirement_type: 'COUNSELOR_TRAINING',
          mode: 'WARN',
          effective_from: '2027-01-01',
          equivalent_certification: {
            certification_id: 7,
            name: 'Curso de consejeros',
          },
          active: true,
          modified_at: '2026-11-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('changes mode and date and writes an audit event with before and after', async () => {
    const { service, prisma, audit } = setup();
    const result = await service.update(ACTOR, 1, {
      mode: 'BLOCK',
      effective_from: '2027-03-01',
    });
    expect(prisma.role_requirements.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requirement_id: 1 },
        data: {
          mode: 'BLOCK',
          effective_from: new Date('2027-03-01T00:00:00.000Z'),
        },
      }),
    );
    expect(result.mode).toBe('BLOCK');
    const [, event] = audit.write.mock.calls[0] as unknown as [
      unknown,
      Record<string, any>,
    ];
    expect(event).toMatchObject({
      entityType: 'role_requirements',
      entityId: '1',
      action: 'ROLE_REQUIREMENT_UPDATED',
      actor: { kind: 'user', userId: ACTOR },
      before: { mode: 'INFO', effective_from: null },
      after: { mode: 'BLOCK', effective_from: '2027-03-01' },
    });
  });

  it('clears the date and the equivalence with null', async () => {
    const { service, prisma } = setup(
      row({ effective_from: new Date('2027-03-01T00:00:00.000Z') }),
    );
    await service.update(ACTOR, 1, {
      effective_from: null,
      equivalent_certification_id: null,
    });
    expect(prisma.role_requirements.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { effective_from: null, equivalent_certification_id: null },
      }),
    );
  });

  it('sets an active equivalent certification', async () => {
    const { service } = setup();
    const result = await service.update(ACTOR, 1, {
      equivalent_certification_id: 7,
    });
    expect(result.equivalent_certification).toEqual({
      certification_id: 7,
      name: 'Curso de consejeros',
    });
  });

  it('rejects an unknown certification, an invalid date and an unknown requirement', async () => {
    expect(
      await code(
        setup().service.update(ACTOR, 1, { equivalent_certification_id: 99 }),
      ),
    ).toBe(ErrorCode.ROLE_REQUIREMENT_CERTIFICATION_INVALID);
    expect(
      await code(
        setup().service.update(ACTOR, 1, { effective_from: '2027-02-31' }),
      ),
    ).toBe(ErrorCode.ROLE_REQUIREMENT_DATE_INVALID);
    expect(
      await code(setup(null).service.update(ACTOR, 9, { mode: 'WARN' })),
    ).toBe(ErrorCode.ROLE_REQUIREMENT_NOT_FOUND);
  });

  it('an empty patch changes and audits nothing', async () => {
    const { service, prisma, audit } = setup();
    await service.update(ACTOR, 1, {});
    expect(prisma.role_requirements.update).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });
});
