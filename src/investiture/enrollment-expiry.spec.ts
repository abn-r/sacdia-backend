import { expireEnrollmentsInTx } from './enrollment-expiry';
import { pendingInvestitureAuthorization } from '../investiture-requests/investiture-request-lock';

jest.mock('../investiture-requests/investiture-request-lock', () => ({
  pendingInvestitureAuthorization: jest.fn(),
}));

function makeTx() {
  return {
    enrollments: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    investiture_validation_history: { createMany: jest.fn() },
  };
}

describe('expireEnrollmentsInTx', () => {
  const params = { enrollmentIds: [5, 3], actorId: 'actor', comments: 'why' };

  beforeEach(() => {
    (pendingInvestitureAuthorization as jest.Mock).mockReset();
    (pendingInvestitureAuthorization as jest.Mock).mockResolvedValue(false);
  });

  it('expires expirable rows and writes one EXPIRED audit row each', async () => {
    const tx = makeTx();
    tx.enrollments.findMany.mockResolvedValue([
      { enrollment_id: 5 },
      { enrollment_id: 3 },
    ]);
    tx.enrollments.updateMany.mockResolvedValue({ count: 2 });

    const ids = await expireEnrollmentsInTx(tx as never, params);

    expect(ids).toEqual([3, 5]);
    expect(tx.enrollments.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          investiture_status: 'EXPIRED',
          validated_by: 'actor',
        }),
      }),
    );
    expect(tx.investiture_validation_history.createMany).toHaveBeenCalledWith({
      data: [
        {
          enrollment_id: 3,
          action: 'EXPIRED',
          performed_by: 'actor',
          comments: 'why',
        },
        {
          enrollment_id: 5,
          action: 'EXPIRED',
          performed_by: 'actor',
          comments: 'why',
        },
      ],
    });
  });

  it('skips enrollments locked by a pending authorization', async () => {
    const tx = makeTx();
    tx.enrollments.findMany.mockResolvedValue([
      { enrollment_id: 5 },
      { enrollment_id: 3 },
    ]);
    (pendingInvestitureAuthorization as jest.Mock).mockImplementation(
      (_tx: unknown, id: number) => Promise.resolve(id === 3),
    );
    tx.enrollments.updateMany.mockResolvedValue({ count: 1 });

    const ids = await expireEnrollmentsInTx(tx as never, params);

    expect(ids).toEqual([5]);
  });

  it('returns nothing and writes nothing when no row is expirable', async () => {
    const tx = makeTx();
    tx.enrollments.findMany.mockResolvedValue([]);

    expect(await expireEnrollmentsInTx(tx as never, params)).toEqual([]);
    expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
    expect(tx.investiture_validation_history.createMany).not.toHaveBeenCalled();
  });
});
