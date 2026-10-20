import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

async function errorFields(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(UpdateUserDto, body));
  return errors.map((error) => error.property);
}

describe('UpdateUserDto dates', () => {
  it.each([
    ['a date-only birthday (the documented shape)', { birthday: '2000-01-15' }],
    [
      'a full ISO birthday (what the app sends)',
      { birthday: '2000-01-15T06:00:00.000Z' },
    ],
    ['a date-only baptism date', { baptism: true, baptism_date: '2015-06-20' }],
  ])('accepts %s', async (_label, body) => {
    expect(await errorFields(body)).toEqual([]);
  });

  it.each([
    ['birthday', { birthday: '2017-02-31' }],
    ['baptism_date', { baptism: true, baptism_date: '2015-02-30' }],
  ])(
    'rejects an impossible calendar %s with a 400 (it reached Prisma as a 500)',
    async (field, body) => {
      expect(await errorFields(body)).toEqual([field]);
    },
  );
});
