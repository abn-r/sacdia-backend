import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateUserHonorDto,
  StartHonorDto,
  UpdateUserHonorDto,
} from './honors.dto';

const ANA = '7d1f6c52-5a6f-4b8a-9d57-6f6b1a2f3c11';

async function messages<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
): Promise<Record<string, string[]>> {
  const errors = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return Object.fromEntries(
    errors.map((error) => [
      error.property,
      Object.values(error.constraints ?? {}),
    ]),
  );
}

describe('user honors DTOs (B5)', () => {
  describe('completedAt', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-12T15:00:00.000Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('rejects 1959-12-31 with HONOR_DATE_TOO_OLD', async () => {
      await expect(
        messages(UpdateUserHonorDto, { completedAt: '1959-12-31' }),
      ).resolves.toEqual({ completedAt: ['HONOR_DATE_TOO_OLD'] });
    });

    it.each(['1960-01-01', '2026-10-12', '2020-02-29'])(
      'accepts %s',
      async (completedAt) => {
        await expect(
          messages(UpdateUserHonorDto, { completedAt }),
        ).resolves.toEqual({});
      },
    );

    it('rejects tomorrow with HONOR_DATE_IN_FUTURE', async () => {
      await expect(
        messages(UpdateUserHonorDto, { completedAt: '2026-10-13' }),
      ).resolves.toEqual({ completedAt: ['HONOR_DATE_IN_FUTURE'] });
    });

    it.each(['2026-02-30', 'not-a-date', '2026-04-12T10:00:00Z', 20260412])(
      'rejects the malformed value %p',
      async (completedAt) => {
        const result = await messages(UpdateUserHonorDto, { completedAt });
        expect(Object.keys(result)).toEqual(['completedAt']);
      },
    );

    it('treats null (clear) and undefined (no change) as valid', async () => {
      await expect(
        messages(UpdateUserHonorDto, { completedAt: null }),
      ).resolves.toEqual({});
      await expect(messages(UpdateUserHonorDto, {})).resolves.toEqual({});
    });

    it('is accepted on the create DTO too', async () => {
      await expect(
        messages(CreateUserHonorDto, { honorId: 1, completedAt: '2026-10-13' }),
      ).resolves.toEqual({ completedAt: ['HONOR_DATE_IN_FUTURE'] });
    });
  });

  describe('date (start) range', () => {
    it.each([
      [UpdateUserHonorDto, {}],
      [StartHonorDto, {}],
      [CreateUserHonorDto, { honorId: 1 }],
    ] as const)('%p rejects a start date before 1960', async (cls, base) => {
      await expect(
        messages(cls as new () => object, { ...base, date: '1959-12-31' }),
      ).resolves.toEqual({ date: ['HONOR_DATE_TOO_OLD'] });
    });
  });

  describe('instructor', () => {
    it('accepts a uuid, a free name and null (clear)', async () => {
      await expect(
        messages(UpdateUserHonorDto, { instructorUserId: ANA }),
      ).resolves.toEqual({});
      await expect(
        messages(UpdateUserHonorDto, { instructorName: 'Juan López Ruiz' }),
      ).resolves.toEqual({});
      await expect(
        messages(UpdateUserHonorDto, {
          instructorUserId: null,
          instructorName: null,
        }),
      ).resolves.toEqual({});
    });

    it('rejects an invalid uuid', async () => {
      const result = await messages(UpdateUserHonorDto, {
        instructorUserId: 'not-a-uuid',
      });
      expect(Object.keys(result)).toEqual(['instructorUserId']);
    });

    it.each(['Al', 'x'.repeat(151), 'Juan\u0000 López'])(
      'rejects the free name %p',
      async (instructorName) => {
        const result = await messages(UpdateUserHonorDto, { instructorName });
        expect(Object.keys(result)).toEqual(['instructorName']);
      },
    );

    it('trims and collapses the free name before validating', async () => {
      const dto = plainToInstance(UpdateUserHonorDto, {
        instructorName: '  Juan   López  ',
      });
      expect(dto.instructorName).toBe('Juan López');
    });

    it('exists on the create DTO but not on StartHonorDto (enrolls before teaching)', async () => {
      await expect(
        messages(CreateUserHonorDto, {
          honorId: 1,
          instructorName: 'Juan López',
        }),
      ).resolves.toEqual({});
      await expect(
        messages(StartHonorDto, { instructorName: 'Juan López' }),
      ).resolves.toEqual({ instructorName: expect.any(Array) });
    });
  });
});
