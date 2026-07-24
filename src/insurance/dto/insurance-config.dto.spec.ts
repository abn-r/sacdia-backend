import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateInsuranceCycleDto } from './insurance-config.dto';

describe('CreateInsuranceCycleDto', () => {
  const validInput = {
    insurance_product_id: 7,
    ecclesiastical_year_id: 2026,
    club_type_id: 3,
    unit_cost: 125.5,
    purchase_deadline: '2026-03-31',
    timezone: 'America/Mexico_City',
  };

  it('rejects an invalid timezone while accepting an IANA timezone', async () => {
    const invalid = await validate(
      plainToInstance(CreateInsuranceCycleDto, {
        ...validInput,
        timezone: 'Mexico-City-UTC-6',
      }),
    );
    const valid = await validate(
      plainToInstance(CreateInsuranceCycleDto, validInput),
    );

    expect(invalid.some((error) => error.property === 'timezone')).toBe(true);
    expect(valid.some((error) => error.property === 'timezone')).toBe(false);
  });
});
