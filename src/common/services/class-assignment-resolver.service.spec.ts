import { ClassAssignmentResolverService } from './class-assignment-resolver.service';

describe('ClassAssignmentResolverService', () => {
  const createTxMock = () => ({
    users: {
      findUnique: jest.fn().mockResolvedValue({
        birthday: new Date('2016-01-01T00:00:00.000Z'),
      }),
    },
    classes: {
      findFirst: jest.fn().mockResolvedValue({
        class_id: 5,
      }),
      findUnique: jest.fn().mockResolvedValue({
        class_id: 5,
        active: true,
        club_type_id: 2,
        minimum_age: 10,
        available_from_year: null,
        available_until_year: null,
      }),
    },
  });

  let service: ClassAssignmentResolverService;
  let tx: ReturnType<typeof createTxMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClassAssignmentResolverService();
    tx = createTxMock();
  });

  it('derives the expected class from birthday, year start, and club type when class_id is omitted or null', async () => {
    const baseParams = {
      userId: 'user-1',
      clubTypeId: 2,
      currentYear: {
        year_id: 2026,
        start_date: new Date('2026-01-01T00:00:00.000Z'),
      },
    };

    await expect(
      service.resolveClassIdForUserClubType(tx as any, baseParams),
    ).resolves.toBe(5);
    await expect(
      service.resolveClassIdForUserClubType(tx as any, {
        ...baseParams,
        requestedClassId: null,
      }),
    ).resolves.toBe(5);

    expect(tx.classes.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { class_id: null } }),
    );
  });

  it('rejects a requested class that differs from the age-derived class', async () => {
    tx.classes.findFirst.mockResolvedValue({ class_id: 5 });
    tx.classes.findUnique.mockResolvedValue({
      class_id: 6,
      active: true,
      club_type_id: 2,
      minimum_age: 11,
      available_from_year: null,
      available_until_year: null,
    });

    await expect(
      service.resolveClassIdForUserClubType(tx as any, {
        userId: 'user-1',
        requestedClassId: 6,
        clubTypeId: 2,
        currentYear: {
          year_id: 2026,
          start_date: new Date('2026-01-01T00:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'POST_REG_CLASS_NOT_ELIGIBLE' });
  });
});
