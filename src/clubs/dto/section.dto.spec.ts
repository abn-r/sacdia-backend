import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateClubSectionDto } from './section.dto';

describe('CreateClubSectionDto', () => {
  it('allows name when creating a club section', async () => {
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

    expect(errors).toEqual([]);
  });
});
