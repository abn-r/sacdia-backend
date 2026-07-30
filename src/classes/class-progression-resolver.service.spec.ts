import { ErrorCode } from '../common/errors/error-codes';
import { ClassProgressionResolver } from './class-progression-resolver.service';

describe('ClassProgressionResolver', () => {
  const resolver = new ClassProgressionResolver();
  const yearStart = new Date('2027-01-01T00:00:00.000Z');
  const classesById = new Map([
    [1, { class_id: 1, club_type_id: 10, display_order: 1 }],
    [2, { class_id: 2, club_type_id: 10, display_order: 2 }],
    [3, { class_id: 3, club_type_id: 20, display_order: 1 }],
  ]);

  const createTx = (options?: {
    transitionTargetClubTypeId?: number | null;
    trackClasses?: Map<number, Array<Record<string, number>>>;
  }) => {
    const trackClasses =
      options?.trackClasses ??
      new Map([
        [10, [classesById.get(1)!, classesById.get(2)!]],
        [20, [classesById.get(3)!]],
      ]);
    return {
      classes: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(classesById.get(where.class_id) ?? null),
        ),
        findMany: jest.fn(({ where }) =>
          Promise.resolve(trackClasses.get(where.club_type_id) ?? []),
        ),
      },
      class_progression_tracks: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            trackClasses.has(where.club_type_id)
              ? { class_progression_track_id: where.club_type_id }
              : null,
          ),
        ),
      },
      class_progression_track_transitions: {
        findMany: jest.fn().mockResolvedValue(
          options?.transitionTargetClubTypeId
            ? [
                {
                  to_track: {
                    club_type_id: options.transitionTargetClubTypeId,
                  },
                },
              ]
            : [],
        ),
      },
    } as any;
  };

  it('resolves first class and same-track predecessor by display_order', async () => {
    const tx = createTx();

    await expect(resolver.resolveFirst(tx, 10, yearStart)).resolves.toEqual(
      classesById.get(1),
    );
    await expect(
      resolver.resolvePredecessor(tx, 1, yearStart),
    ).resolves.toBeNull();
    await expect(
      resolver.resolvePredecessor(tx, 2, yearStart),
    ).resolves.toEqual(classesById.get(1));
  });

  it('resolves the next class inside the same active track', async () => {
    await expect(
      resolver.resolveNext(createTx(), 1, yearStart),
    ).resolves.toEqual(classesById.get(2));
  });

  it('uses an explicit active crossover from the last source class', async () => {
    const tx = createTx({ transitionTargetClubTypeId: 20 });

    await expect(resolver.resolveNext(tx, 2, yearStart)).resolves.toEqual(
      classesById.get(3),
    );
    await expect(resolver.resolveTransition(tx, 2, 3, yearStart)).resolves.toBe(
      'CROSSOVER',
    );
  });

  it('fails closed when a requested crossover is not configured', async () => {
    await expect(
      resolver.resolveTransition(createTx(), 2, 3, yearStart),
    ).rejects.toMatchObject({ code: ErrorCode.CLASS_LEVEL_TOO_HIGH });
  });

  it('rejects ambiguous display_order configuration', async () => {
    const duplicateOrder = new Map([
      [
        10,
        [
          classesById.get(1)!,
          { class_id: 4, club_type_id: 10, display_order: 1 },
        ],
      ],
    ]);

    await expect(
      resolver.resolveFirst(
        createTx({ trackClasses: duplicateOrder }),
        10,
        yearStart,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CLASS_PROGRESSION_CONFIG_INVALID,
    });
  });
});
