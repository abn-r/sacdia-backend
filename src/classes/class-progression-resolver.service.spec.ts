import { ErrorCode } from '../common/errors/error-codes';
import { ClassProgressionResolver } from './class-progression-resolver.service';

const yearStart = new Date('2027-01-01T00:00:00.000Z');
const classRow = (
  class_id: number,
  club_type_id: number,
  display_order: number,
  partial: any = {},
) => ({
  class_id,
  club_type_id,
  display_order,
  active: true,
  available_from_year_id: null,
  available_until_year_id: null,
  ...partial,
});
const defaultClasses = [1, 2, 3, 4, 5].map((id) =>
  classRow(id, id < 3 ? 10 : id < 5 ? 20 : 30, id % 2 ? 1 : 2),
);
const defaultTracks = [10, 20, 30].map((id) => ({
  club_type_id: id,
  active: true,
}));

const matchesTrack = (track: any, where: any) =>
  (where.club_type_id === undefined ||
    track.club_type_id === where.club_type_id) &&
  (where.active === undefined || track.active === where.active);
const matchesClass = (item: any, where: any) => {
  if (
    where.club_type_id !== item.club_type_id ||
    (where.active !== undefined && where.active !== item.active)
  )
    return false;
  return (where.AND ?? []).every((clause: any) =>
    clause.OR.some((option: any) => {
      if ('available_from_year_id' in option)
        return item.available_from_year_id === null;
      if ('available_until_year_id' in option)
        return item.available_until_year_id === null;
      const from = option.available_from_year?.start_date?.lte;
      if (from)
        return !!item.available_from_start && item.available_from_start <= from;
      const until = option.available_until_year?.start_date?.gte;
      return (
        !!item.available_until_start && item.available_until_start >= until
      );
    }),
  );
};

const createTx = ({
  classes = defaultClasses,
  tracks = defaultTracks,
  transitions = [],
}: any = {}) =>
  ({
    classes: {
      findUnique: jest.fn(({ where }) =>
        Promise.resolve(
          classes.find((item) => item.class_id === where.class_id) ?? null,
        ),
      ),
      findMany: jest.fn(({ where }) =>
        Promise.resolve(
          classes
            .filter((item) => matchesClass(item, where))
            .sort(
              (a, b) =>
                a.display_order - b.display_order || a.class_id - b.class_id,
            ),
        ),
      ),
    },
    class_progression_tracks: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(
          tracks.find((track) => matchesTrack(track, where)) ?? null,
        ),
      ),
    },
    class_progression_track_transitions: {
      findMany: jest.fn(({ where }) =>
        Promise.resolve(
          transitions
            .filter(
              (item) =>
                (where.active === undefined || item.active === where.active) &&
                matchesTrack(item.from_track, where.from_track ?? {}) &&
                matchesTrack(item.to_track, where.to_track ?? {}),
            )
            .map((item) => ({
              to_track: { club_type_id: item.to_track.club_type_id },
            })),
        ),
      ),
    },
  }) as any;

describe('ClassProgressionResolver', () => {
  const resolver = new ClassProgressionResolver();

  it('filters inactive and unavailable classes with the canonical availability query', async () => {
    const tx = createTx({
      classes: [
        classRow(1, 10, 1, { active: false }),
        classRow(2, 10, 2, {
          available_until_year_id: 1,
          available_until_start: new Date('2026-01-01T00:00:00.000Z'),
        }),
        classRow(3, 10, 3, {
          available_from_year_id: 2,
          available_from_start: new Date('2028-01-01T00:00:00.000Z'),
        }),
        classRow(4, 10, 4),
      ],
    });
    await expect(
      resolver.resolveFirst(tx, 10, yearStart),
    ).resolves.toMatchObject({ class_id: 4 });
    expect(tx.classes.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          AND: expect.any(Array),
        }),
      }),
    );
    await expect(
      resolver.resolveFirst(
        createTx({ tracks: [{ club_type_id: 10, active: false }] }),
        10,
        yearStart,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CLASS_PROGRESSION_CONFIG_INVALID,
    });
  });

  it('rejects an inactive track with a stable configuration error', async () => {
    await expect(
      resolver.resolveFirst(
        createTx({ tracks: [{ club_type_id: 10, active: false }] }),
        10,
        yearStart,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CLASS_PROGRESSION_CONFIG_INVALID,
    });
  });

  it('allows only the configured active AV→CQ and CQ→GM crossovers', async () => {
    const tx = createTx({
      transitions: [
        {
          active: true,
          from_track: defaultTracks[0],
          to_track: defaultTracks[1],
        },
        {
          active: true,
          from_track: defaultTracks[1],
          to_track: defaultTracks[2],
        },
      ],
    });
    await expect(resolver.resolveNext(tx, 2, yearStart)).resolves.toMatchObject(
      { class_id: 3 },
    );
    await expect(resolver.resolveNext(tx, 4, yearStart)).resolves.toMatchObject(
      { class_id: 5 },
    );
    await expect(resolver.resolveTransition(tx, 2, 3, yearStart)).resolves.toBe(
      'CROSSOVER',
    );
    await expect(resolver.resolveTransition(tx, 4, 5, yearStart)).resolves.toBe(
      'CROSSOVER',
    );
  });

  it('ignores inactive transition rows and targets', async () => {
    const inactiveTransition = createTx({
      transitions: [
        {
          active: false,
          from_track: defaultTracks[0],
          to_track: defaultTracks[1],
        },
      ],
    });
    const inactiveTarget = createTx({
      transitions: [
        {
          active: true,
          from_track: defaultTracks[1],
          to_track: { club_type_id: 30, active: false },
        },
      ],
    });
    await expect(
      resolver.resolveNext(inactiveTransition, 2, yearStart),
    ).resolves.toBeNull();
    await expect(
      resolver.resolveNext(inactiveTarget, 4, yearStart),
    ).resolves.toBeNull();
    expect(
      inactiveTransition.class_progression_track_transitions.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          active: true,
          from_track: expect.objectContaining({ active: true }),
          to_track: expect.objectContaining({ active: true }),
        }),
      }),
    );
  });

  it('fails closed for ambiguous or absent crossovers with stable errors', async () => {
    const ambiguous = createTx({
      transitions: [
        {
          active: true,
          from_track: defaultTracks[0],
          to_track: defaultTracks[1],
        },
        {
          active: true,
          from_track: defaultTracks[0],
          to_track: defaultTracks[2],
        },
      ],
    });
    await expect(
      resolver.resolveNext(ambiguous, 2, yearStart),
    ).rejects.toMatchObject({
      code: ErrorCode.CLASS_PROGRESSION_CONFIG_INVALID,
    });
    await expect(
      resolver.resolveTransition(createTx(), 2, 3, yearStart),
    ).rejects.toMatchObject({ code: ErrorCode.CLASS_LEVEL_TOO_HIGH });
  });
});
