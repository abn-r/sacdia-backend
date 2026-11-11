import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FinanceExportQueryDto } from './finance-reports.dto';

async function errorsFor(plain: Record<string, unknown>) {
  const dto = plainToInstance(FinanceExportQueryDto, plain);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('FinanceExportQueryDto format', () => {
  it.each([undefined, 'xlsx', 'pdf'])('accepts format=%s', async (format) => {
    const errors = await errorsFor({ year: '2026', format });
    expect(errors).toHaveLength(0);
  });

  it.each(['csv', 'PDF', '', 'docx'])('rejects format=%p', async (format) => {
    const errors = await errorsFor({ year: '2026', format });
    expect(errors.map((e) => e.property)).toEqual(['format']);
  });
});
