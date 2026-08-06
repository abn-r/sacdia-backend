import { AuthorizationContextVersionService } from './authorization-context-version.service';

describe('AuthorizationContextVersionService', () => {
  const upsert = jest.fn().mockResolvedValue({ version: 1n });
  const createMany = jest.fn().mockResolvedValue({ count: 0 });
  const updateMany = jest.fn().mockResolvedValue({ count: 2 });
  const tx = {
    authorization_context_versions: { upsert, createMany, updateMany },
  };
  const service = new AuthorizationContextVersionService({} as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bumps multiple users in deterministic sorted order', async () => {
    const order: string[] = [];
    upsert.mockImplementation(async ({ where }: { where: { user_id: string } }) => {
      order.push(where.user_id);
      return { version: 1n };
    });

    await service.bumpOrdered(tx as never, [
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
    ]);

    expect(order).toEqual([
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000003',
    ]);
  });

  it('bumps many users with a set-based write', async () => {
    await service.bumpMany(tx as never, [
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
    ]);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        { user_id: '00000000-0000-0000-0000-000000000001', version: 0n },
        { user_id: '00000000-0000-0000-0000-000000000002', version: 0n },
      ],
      skipDuplicates: true,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        user_id: {
          in: [
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000002',
          ],
        },
      },
      data: { version: { increment: 1 } },
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});
