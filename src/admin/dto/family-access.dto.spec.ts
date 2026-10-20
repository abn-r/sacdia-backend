import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminFamilyAccessReasonDto } from './family-access.dto';

const check = async (body: unknown) =>
  validate(plainToInstance(AdminFamilyAccessReasonDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('AdminFamilyAccessReasonDto', () => {
  it('accepts a reason of 5 or more characters', async () => {
    expect(await check({ reason: 'abcde' })).toHaveLength(0);
    expect(
      await check({ reason: 'Solicitud escrita del tutor legal' }),
    ).toHaveLength(0);
  });

  it.each([
    ['missing', {}],
    ['4 characters', { reason: 'abcd' }],
    ['5 characters of spaces', { reason: '     ' }],
    ['4 characters plus padding (trimmed first)', { reason: '  abcd  ' }],
    ['not a string', { reason: 12345 }],
    ['over 500 characters', { reason: 'a'.repeat(501) }],
  ])('rejects %s', async (_label, body) => {
    expect((await check(body)).length).toBeGreaterThan(0);
  });

  it('trims the reason before it is stored', () => {
    const dto = plainToInstance(AdminFamilyAccessReasonDto, {
      reason: '  Teléfono extraviado  ',
    });
    expect(dto.reason).toBe('Teléfono extraviado');
  });

  it('refuses a password or any other key (nothing else is accepted)', async () => {
    const errors = await check({ reason: 'abcde', password: 'Str0ng@Pass1!x' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
