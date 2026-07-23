import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFinanceCategoryDto } from './phase-e-catalogs.dto';

describe('CreateFinanceCategoryDto', () => {
  it('accepts income category type 0', async () => {
    const dto = plainToInstance(CreateFinanceCategoryDto, {
      name: 'Cuotas',
      type: 0,
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('rejects category types outside income and expense', async () => {
    const dto = plainToInstance(CreateFinanceCategoryDto, {
      name: 'Otro',
      type: 2,
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'type')).toBe(true);
  });
});
