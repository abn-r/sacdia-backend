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
