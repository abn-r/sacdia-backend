import { OrdersService } from './orders.service';

describe('OrdersService.list search escaping', () => {
  const prisma = {
    materialOrder: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const service = new OrdersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('escapes LIKE wildcards in q for folio and creator names', async () => {
    await service.list(
      { q: 'SOL%_1' },
      { id: 'u1', canApprove: true },
      undefined,
    );

    const { where } = prisma.materialOrder.findMany.mock.calls[0][0];
    const escaped = 'SOL\\%\\_1';
    expect(where.OR).toEqual([
      { folio_referencia: { contains: escaped, mode: 'insensitive' } },
      { creator: { name: { contains: escaped, mode: 'insensitive' } } },
      {
        creator: {
          paternal_last_name: { contains: escaped, mode: 'insensitive' },
        },
      },
    ]);
  });
});
