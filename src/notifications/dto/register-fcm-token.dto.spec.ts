import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterFcmTokenDto } from '../notifications.controller';
import { RegisterFcmTokenRequestDto } from './notification-preferences.dto';

// Both registration endpoints (POST /fcm-tokens and POST /users/me/fcm-tokens)
// accept the same optional `kind`.
describe.each([
  ['POST /fcm-tokens', RegisterFcmTokenDto],
  ['POST /users/me/fcm-tokens', RegisterFcmTokenRequestDto],
] as const)('%s body', (_name, Dto) => {
  const check = (plain: Record<string, unknown>) =>
    validate(plainToInstance(Dto, plain as object));

  it('accepts a body without kind (old app versions)', async () => {
    expect(await check({ token: 'abc' })).toHaveLength(0);
  });

  it.each(['token', 'fid'])('accepts kind "%s"', async (kind) => {
    expect(await check({ token: 'abc', kind })).toHaveLength(0);
  });

  it.each(['TOKEN', 'installation', '', 1])(
    'rejects invalid kind %p',
    async (kind) => {
      const errors = await check({ token: 'abc', kind });
      expect(errors.map((e) => e.property)).toContain('kind');
    },
  );

  it('still requires token', async () => {
    const errors = await check({ kind: 'fid' });
    expect(errors.map((e) => e.property)).toContain('token');
  });
});
