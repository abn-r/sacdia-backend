import { CatalogService } from './catalog.service';

describe('CatalogService.list search escaping', () => {
  const prisma = {
    materialProduct: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const service = new CatalogService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('escapes LIKE wildcards in q for the title', async () => {
    await service.list({ q: 'cap%_x' }, false, undefined);

    const { where } = prisma.materialProduct.findMany.mock.calls[0][0];
    expect(where.title).toEqual({
      contains: 'cap\\%\\_x',
      mode: 'insensitive',
    });
  });
});
