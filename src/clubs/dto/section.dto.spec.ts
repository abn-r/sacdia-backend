import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateClubSectionDto } from './section.dto';

describe('CreateClubSectionDto', () => {
  it('rejects a custom section name', async () => {
    const dto = plainToInstance(CreateClubSectionDto, {
      club_type_id: 1,
      name: 'Aventureros Central',
      souls_target: 0,
      fee: 0,
      meeting_day: [{ day: 'Sunday' }],
      meeting_time: [{ time: '09:00' }],
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });

  it('accepts a type-only payload', async () => {
    const dto = plainToInstance(CreateClubSectionDto, {
      club_type_id: 1,
      souls_target: 0,
      fee: 0,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual([]);
  });
});
