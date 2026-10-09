import { closePendingInvestitureAuthorizations } from './investiture-year-close';

describe('closePendingInvestitureAuthorizations', () => {
  function txWith(pending: unknown[]) {
    const tx = {
      investiture_authorization_people: {
        findMany: jest.fn().mockResolvedValue(pending),
        updateMany: jest.fn().mockResolvedValue({ count: pending.length }),
      },
      investiture_authorization_requests: {
        create: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      enrollments: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    return { tx };
  }

  it('closes only pending rows and a second call does not write again', async () => {
    const pending = [
      {
        person_id: 'pending-person',
        user_id: 'user-b',
        enrollment_id: 9,
        request: { club_section_id: 3, ecclesiastical_year_id: 2026 },
      },
    ];
    const { tx } = txWith(pending);

    const closed = await closePendingInvestitureAuthorizations(tx as never, {
      ecclesiastical_year_id: 2026,
    });
    tx.investiture_authorization_people.findMany.mockResolvedValue([]);
    const again = await closePendingInvestitureAuthorizations(tx as never, {
      ecclesiastical_year_id: 2026,
    });

    expect(closed).toBe(1);
    expect(again).toBe(0);
    expect(
      tx.investiture_authorization_people.updateMany,
    ).toHaveBeenCalledTimes(1);
    expect(tx.investiture_authorization_people.updateMany).toHaveBeenCalledWith(
      {
        where: {
          person_id: { in: ['pending-person'] },
          status: 'PENDING',
        },
        data: {
          status: 'CLOSED_YEAR',
          resolution_code: 'CLOSED_YEAR',
        },
      },
    );
    expect(tx.investiture_authorization_requests.create).not.toHaveBeenCalled();
    expect(
      JSON.stringify(tx.investiture_authorization_people.updateMany.mock.calls),
    ).not.toContain('Falta de requisitos para investidura');
    expect(tx.enrollments.update).not.toHaveBeenCalled();
    expect(tx.enrollments.updateMany).not.toHaveBeenCalled();
    expect(tx.investiture_authorization_people.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'PENDING',
          request: { ecclesiastical_year_id: 2026 },
        },
      }),
    );
  });

  it('C1R-N1 does not lock a lower discovered year after a higher declared year', async () => {
    const keys: string[] = [];
    const { tx } = txWith([
      {
        person_id: 'pending-person',
        user_id: 'user-b',
        enrollment_id: 9,
        request: { club_section_id: 3, ecclesiastical_year_id: 2025 },
      },
    ]);
    tx.$executeRaw.mockImplementation(async (query: { values?: unknown[] }) => {
      const value = query?.values?.[0];
      if (typeof value === 'string') keys.push(value);
      return 0;
    });

    await expect(
      closePendingInvestitureAuthorizations(
        tx as never,
        { ecclesiastical_year_id: { in: [2026] } },
        [2026],
      ),
    ).rejects.toThrow('INVESTITURE_YEAR_LOCK_ORDER');

    const yearKeys = keys.filter((key) =>
      key.startsWith('investiture-authorization-year:'),
    );
    expect(yearKeys).toEqual(['investiture-authorization-year:2026']);
  });
});
