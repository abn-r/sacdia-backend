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
