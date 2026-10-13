import { InventoryService } from './inventory.service';

describe('InventoryService.list search escaping', () => {
  const prisma = {
    materialProduct: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const service = new InventoryService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('escapes LIKE wildcards in q for title and sku', async () => {
    await service.list({ q: 'cap%_x' }, undefined);

    const { where } = prisma.materialProduct.findMany.mock.calls[0][0];
    const escaped = 'cap\\%\\_x';
    expect(where.OR).toEqual([
      { title: { contains: escaped, mode: 'insensitive' } },
      { sku: { contains: escaped, mode: 'insensitive' } },
    ]);
  });
});
