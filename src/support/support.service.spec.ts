import { memberInLocalFieldWhere } from '../common/authorization/actor-territory-scope';
import { effectiveAssignmentAt } from '../common/testing/effective-assignment.testing';
import { SupportService } from './support.service';

describe('SupportService.listReports search escaping', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    support_reports: { findMany, count },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const authorizationContext = {
    resolveUserAuthorization: jest.fn().mockResolvedValue({
      authorization: {
        grants: { global_roles: [{ role_name: 'admin' }] },
        effective: { scope: { global: {} } },
      },
    }),
  };
  const service = new SupportService(
    prisma as never,
    authorizationContext as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('escapes LIKE wildcards in the free-text search', async () => {
    await service.listReports('actor', { search: ' 50%_off ' });

    const where = findMany.mock.calls[0][0].where;
    const or = where.AND[0].OR;
    const escaped = '50\\%\\_off';
    expect(or).toEqual(
      expect.arrayContaining([
        { title: { contains: escaped, mode: 'insensitive' } },
        { description: { contains: escaped, mode: 'insensitive' } },
        { user: { email: { contains: escaped, mode: 'insensitive' } } },
        { user: { name: { contains: escaped, mode: 'insensitive' } } },
        {
          user: {
            paternal_last_name: { contains: escaped, mode: 'insensitive' },
          },
        },
        {
          user: {
            maternal_last_name: { contains: escaped, mode: 'insensitive' },
          },
        },
      ]),
    );
    expect(or).toHaveLength(6);
  });
});

describe('SupportService.listReports local field scope', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const prisma = {
    support_reports: { findMany, count },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const authorizationContext = {
    resolveUserAuthorization: jest.fn().mockResolvedValue({
      authorization: {
        grants: { global_roles: [{ role_name: 'director-lf' }] },
        effective: { scope: { global: { local_field: { id: 7 } } } },
      },
    }),
  };
  const EFFECTIVE = effectiveAssignmentAt(new Date('2026-10-28T12:00:00.000Z'));
  const memberScope = {
    effectiveAssignmentForLocalField: jest.fn(async () => EFFECTIVE),
  };
  const service = new SupportService(
    prisma as never,
    authorizationContext as never,
    {} as never,
    memberScope as never,
  );

  it('scopes reporters by users.local_field_id OR an EFFECTIVE (canonical policy) club role in the field', async () => {
    await service.listReports('actor', {});

    expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain(
      JSON.stringify({ user: memberInLocalFieldWhere(7, EFFECTIVE) }),
    );
  });
});
