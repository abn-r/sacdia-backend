import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FinanceMonthlyQueryDto } from './finance-reports.dto';

async function errorsFor(plain: Record<string, unknown>) {
  const dto = plainToInstance(FinanceMonthlyQueryDto, plain);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('FinanceMonthlyQueryDto', () => {
  it('accepts an empty query and valid YYYY-MM values', async () => {
    expect(await errorsFor({})).toHaveLength(0);
    expect(
      await errorsFor({ from: '2026-01', to: '2026-12', club_section_id: '3' }),
    ).toHaveLength(0);
  });

  it.each(['2026-13', '2026-00', '2026-1', '26-01', '2026/01', '2026-01-01'])(
    'rejects from=%p',
    async (from) => {
      const errors = await errorsFor({ from });
      expect(errors.map((e) => e.property)).toEqual(['from']);
    },
  );

  it('rejects a malformed `to` and a bad section id', async () => {
    const errors = await errorsFor({ to: 'abc', club_section_id: '0' });
    expect(errors.map((e) => e.property).sort()).toEqual([
      'club_section_id',
      'to',
    ]);
  });
});
