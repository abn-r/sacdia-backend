import { ConfigService } from './config.service';

describe('ConfigService.listForScope', () => {
  const findMany = jest.fn();
  const service = new ConfigService({
    materialConfig: { findMany },
  } as never);

  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it('lists every config when the actor is unscoped', async () => {
    await service.listForScope(undefined);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { local_field_id: 'asc' },
      }),
    );
    expect(findMany.mock.calls[0][0].where).toBeUndefined();
  });

  it('filters union/division lists to the resolved local_field ids', async () => {
    await service.listForScope([8, 9]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { local_field_id: { in: [8, 9] } },
      }),
    );
  });

  it('returns no rows when the territory has no local fields', async () => {
    await expect(service.listForScope([])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
