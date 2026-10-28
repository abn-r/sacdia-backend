import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateActivityDto,
  CreateActivitySeriesDto,
  UpdateActivityDto,
} from './activities.dto';

async function nameConstraints(
  cls: new () => object,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto);
  const nameError = errors.find((error) => error.property === 'name');
  return Object.keys(nameError?.constraints ?? {});
}

describe('activity DTO name validation', () => {
  describe('CreateActivityDto', () => {
    it.each(['', '   '])('rejects a blank name (%j)', async (name) => {
      await expect(
        nameConstraints(CreateActivityDto, { name }),
      ).resolves.toEqual(expect.arrayContaining(['isNotEmpty']));
    });

    it('rejects a name shorter than 3 chars after trimming', async () => {
      await expect(
        nameConstraints(CreateActivityDto, { name: '  ab  ' }),
      ).resolves.toEqual(['minLength']);
    });

    it('rejects a missing name', async () => {
      await expect(nameConstraints(CreateActivityDto, {})).resolves.not.toEqual(
        [],
      );
    });

    it('accepts and trims a valid name', async () => {
      const dto = plainToInstance(CreateActivityDto, { name: '  Campamento ' });
      expect(dto.name).toBe('Campamento');
      await expect(
        nameConstraints(CreateActivityDto, { name: '  Campamento ' }),
      ).resolves.toEqual([]);
    });

    it('applies the same rule to activity series', async () => {
      await expect(
        nameConstraints(CreateActivitySeriesDto, { name: '' }),
      ).resolves.toEqual(expect.arrayContaining(['isNotEmpty']));
    });
  });

  describe('UpdateActivityDto', () => {
    it('allows omitting the name', async () => {
      await expect(nameConstraints(UpdateActivityDto, {})).resolves.toEqual([]);
    });

    it('rejects a blank name when provided', async () => {
      await expect(
        nameConstraints(UpdateActivityDto, { name: '  ' }),
      ).resolves.toEqual(expect.arrayContaining(['isNotEmpty']));
    });

    it('rejects a name shorter than 3 chars when provided', async () => {
      await expect(
        nameConstraints(UpdateActivityDto, { name: 'ab' }),
      ).resolves.toEqual(['minLength']);
    });

    it('accepts a valid name', async () => {
      await expect(
        nameConstraints(UpdateActivityDto, { name: 'Excursión' }),
      ).resolves.toEqual([]);
    });
  });
});

async function dateConstraints(
  cls: new () => object,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  const dateError = errors.find((error) => error.property === 'activity_date');
  return Object.keys(dateError?.constraints ?? {});
}

describe('activity DTO activity_date validation', () => {
  describe('CreateActivityDto', () => {
    it.each([
      ['missing', {}],
      ['null', { activity_date: null }],
      ['empty', { activity_date: '' }],
    ])('rejects a %s date', async (_label, plain) => {
      await expect(
        dateConstraints(CreateActivityDto, plain),
      ).resolves.not.toEqual([]);
    });

    it('accepts an ISO date', async () => {
      await expect(
        dateConstraints(CreateActivityDto, { activity_date: '2026-11-05' }),
      ).resolves.toEqual([]);
    });

    it('applies the same rule to activity series', async () => {
      await expect(
        dateConstraints(CreateActivitySeriesDto, {}),
      ).resolves.not.toEqual([]);
    });
  });

  describe('UpdateActivityDto', () => {
    it('allows omitting the date', async () => {
      await expect(dateConstraints(UpdateActivityDto, {})).resolves.toEqual([]);
    });

    it.each([
      ['null', null],
      ['empty', ''],
    ])('rejects clearing the date with %s', async (_label, value) => {
      await expect(
        dateConstraints(UpdateActivityDto, { activity_date: value }),
      ).resolves.not.toEqual([]);
    });

    it('accepts a new ISO date', async () => {
      await expect(
        dateConstraints(UpdateActivityDto, { activity_date: '2026-11-06' }),
      ).resolves.toEqual([]);
    });
  });
});
