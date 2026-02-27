import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClubInstanceType, CreateInstanceDto } from './instance.dto';

describe('CreateInstanceDto', () => {
  it('accepts a valid payload with type and numeric values', async () => {
    const dto = plainToInstance(CreateInstanceDto, {
      type: ClubInstanceType.PATHFINDERS,
      souls_target: 1,
      fee: 100,
      meeting_day: [{ day: 'Saturday' }],
      meeting_time: [{ time: '09:00' }],
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects invalid type enum values', async () => {
    const dto = plainToInstance(CreateInstanceDto, {
      type: 'invalid_type',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('type');
    expect(errors[0].constraints).toHaveProperty('isEnum');
  });
});
