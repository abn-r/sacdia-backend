import { ErrorCode } from '../common/errors/error-codes';
import { StorageBucketAlias } from '../common/services/file-storage.service';
import {
  adultBirthdayCutoff,
  INSTRUCTOR_CANDIDATE_LIMIT,
  InstructorsService,
} from './instructors.service';

describe('InstructorsService', () => {
  const prisma = {
    users: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  };
  const fileStorage = { getSignedDownloadUrl: jest.fn() };
  let service: InstructorsService;

  const row = (overrides: Record<string, unknown> = {}) => ({
    user_id: 'u-2',
    name: 'Ana',
    paternal_last_name: 'Pérez',
    maternal_last_name: 'Gómez',
    user_image: null,
    ...overrides,
  });

  const lastFindManyWhere = () =>
    JSON.stringify(prisma.users.findMany.mock.calls.at(-1)?.[0].where);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InstructorsService(prisma as never, fileStorage as never);
    prisma.users.findUnique.mockResolvedValue({ local_field_id: 7 });
    prisma.users.findMany.mockResolvedValue([row()]);
  });

  describe('adultBirthdayCutoff', () => {
    it('subtracts 18 civil years', () => {
      expect(
        adultBirthdayCutoff(new Date('2026-10-12T10:00:00.000Z'))
          .toISOString()
          .slice(0, 10),
      ).toBe('2008-10-12');
    });

    it('does not roll 29 February into March in a non leap year', () => {
      expect(
        adultBirthdayCutoff(new Date('2028-02-29T10:00:00.000Z'))
          .toISOString()
          .slice(0, 10),
      ).toBe('2010-02-28');
    });
  });

  describe('searchCandidates', () => {
    it.each([undefined, '', '   ', 'an', 'a b', 'ana p'])(
      'returns [] without touching the database for q=%j',
      async (q) => {
        await expect(service.searchCandidates('u-1', q)).resolves.toEqual([]);
        expect(prisma.users.findUnique).not.toHaveBeenCalled();
        expect(prisma.users.findMany).not.toHaveBeenCalled();
      },
    );

    it('returns [] when the caller has no local field', async () => {
      prisma.users.findUnique.mockResolvedValue({ local_field_id: null });

      await expect(service.searchCandidates('u-1', 'ana')).resolves.toEqual([]);
      expect(prisma.users.findMany).not.toHaveBeenCalled();
    });

    it('returns [] when the caller does not exist', async () => {
      prisma.users.findUnique.mockResolvedValue(null);

      await expect(service.searchCandidates('u-1', 'ana')).resolves.toEqual([]);
    });

    it('scopes to the caller local field and the eligibility filter', async () => {
      await service.searchCandidates('u-1', 'ana');

      const where = prisma.users.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          {
            active: true,
            approval_status: 'approved',
            local_field_id: 7,
            birthday: { lte: expect.any(Date) },
          },
          { user_id: { not: 'u-1' } },
        ]),
      );
      const { birthday } = where.AND[0];
      expect(birthday.lte.getTime()).toBe(adultBirthdayCutoff().getTime());
    });

    it('does not require Guía Mayor nor any role', async () => {
      await service.searchCandidates('u-1', 'ana');

      expect(lastFindManyWhere()).not.toMatch(/users_roles|roles|gu[ií]a/i);
    });

    it('matches every token on name or last names, never on email', async () => {
      await service.searchCandidates('u-1', 'ana pérez');

      const where = prisma.users.findMany.mock.calls[0][0].where;
      const tokenClauses = where.AND.filter(
        (clause: { OR?: unknown }) => clause.OR,
      );
      expect(tokenClauses).toHaveLength(2);
      for (const clause of tokenClauses) {
        expect(
          Object.keys(clause.OR.map((c: object) => Object.keys(c)[0])),
        ).toHaveLength(3);
        expect(clause.OR.map((c: object) => Object.keys(c)[0])).toEqual([
          'name',
          'paternal_last_name',
          'maternal_last_name',
        ]);
      }
      expect(lastFindManyWhere()).not.toContain('email');
      expect(
        JSON.stringify(prisma.users.findMany.mock.calls[0][0].select),
      ).not.toContain('email');
    });

    it('escapes LIKE wildcards in the term', async () => {
      await service.searchCandidates('u-1', '%%%');

      expect(lastFindManyWhere()).toContain('\\\\%\\\\%\\\\%');
    });

    it('caps results at 10 and orders by name', async () => {
      await service.searchCandidates('u-1', 'ana');

      const args = prisma.users.findMany.mock.calls[0][0];
      expect(INSTRUCTOR_CANDIDATE_LIMIT).toBe(10);
      expect(args.take).toBe(10);
      expect(args.orderBy[0]).toEqual({ name: 'asc' });
    });

    it('exposes only user_id, display_name and photo_url', async () => {
      prisma.users.findMany.mockResolvedValue([
        row({
          // Aunque la fila trajera más datos, no deben salir.
          email: 'ana@example.com',
          birthday: new Date('1990-01-01'),
          user_image: 'users/u-2.jpg',
        }),
      ]);
      fileStorage.getSignedDownloadUrl.mockResolvedValue('https://signed/u-2');

      const [candidate] = await service.searchCandidates('u-1', 'ana');

      expect(Object.keys(candidate).sort()).toEqual([
        'display_name',
        'photo_url',
        'user_id',
      ]);
      expect(candidate).toEqual({
        user_id: 'u-2',
        display_name: 'Ana Pérez Gómez',
        photo_url: 'https://signed/u-2',
      });
      expect(fileStorage.getSignedDownloadUrl).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        'users/u-2.jpg',
        { expiresInSeconds: 600 },
      );
    });

    it('selects no personal column besides name, last names and photo', async () => {
      await service.searchCandidates('u-1', 'ana');

      expect(
        Object.keys(prisma.users.findMany.mock.calls[0][0].select).sort(),
      ).toEqual([
        'maternal_last_name',
        'name',
        'paternal_last_name',
        'user_id',
        'user_image',
      ]);
    });

    it('returns photo_url null when there is no photo or signing fails', async () => {
      prisma.users.findMany.mockResolvedValue([
        row({ user_id: 'u-2', user_image: null }),
        row({ user_id: 'u-3', user_image: 'users/u-3.jpg' }),
      ]);
      fileStorage.getSignedDownloadUrl.mockRejectedValue(new Error('r2 down'));

      const result = await service.searchCandidates('u-1', 'ana');

      expect(result.map((r) => r.photo_url)).toEqual([null, null]);
    });
  });

  describe('assertEligible', () => {
    it('rejects the owner choosing themselves without hitting the database', async () => {
      await expect(service.assertEligible('u-1', 'u-1')).rejects.toMatchObject({
        code: ErrorCode.HONOR_INSTRUCTOR_SELF,
      });
      expect(prisma.users.findUnique).not.toHaveBeenCalled();
    });

    it('is INVALID when the owner has no local field', async () => {
      prisma.users.findUnique.mockResolvedValue({ local_field_id: null });

      await expect(service.assertEligible('u-1', 'u-2')).rejects.toMatchObject({
        code: ErrorCode.HONOR_INSTRUCTOR_INVALID,
      });
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
    });

    it('is INVALID for another field, inactive, unapproved or minor (same filter as the search)', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      await expect(service.assertEligible('u-1', 'u-2')).rejects.toMatchObject({
        code: ErrorCode.HONOR_INSTRUCTOR_INVALID,
      });
      expect(prisma.users.findFirst).toHaveBeenCalledWith({
        where: {
          user_id: 'u-2',
          active: true,
          approval_status: 'approved',
          local_field_id: 7,
          birthday: { lte: expect.any(Date) },
        },
        select: { user_id: true },
      });
    });

    it('evaluates the scope against the OWNER, not the caller', async () => {
      prisma.users.findUnique.mockImplementation(
        async ({ where }: { where: { user_id: string } }) =>
          where.user_id === 'owner' ? { local_field_id: 99 } : null,
      );
      prisma.users.findFirst.mockResolvedValue({ user_id: 'u-2' });

      await expect(
        service.assertEligible('owner', 'u-2'),
      ).resolves.toBeUndefined();
      expect(prisma.users.findFirst.mock.calls[0][0].where.local_field_id).toBe(
        99,
      );
    });
  });
});
