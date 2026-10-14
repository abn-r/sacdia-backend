import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DeleteAccountDto } from './delete-account.dto';

async function errorsFor(body: unknown) {
  return validate(plainToInstance(DeleteAccountDto, body));
}

describe('DeleteAccountDto', () => {
  it('accepts a password only', async () => {
    expect(await errorsFor({ password: 'MyPassword123!' })).toHaveLength(0);
  });

  it('accepts a social re-auth only', async () => {
    expect(
      await errorsFor({ provider: 'google', idToken: 't', nonce: 'n' }),
    ).toHaveLength(0);
  });

  it('rejects a body carrying both branches', async () => {
    expect(
      await errorsFor({
        password: 'MyPassword123!',
        provider: 'google',
        idToken: 't',
        nonce: 'n',
      }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor({ password: 'MyPassword123!', idToken: 't' }),
    ).not.toHaveLength(0);
  });

  it('rejects a non-string password even when a provider is present', async () => {
    expect(
      await errorsFor({ password: 123, provider: 'google' }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor({ password: { a: 1 }, provider: 'evil' }),
    ).not.toHaveLength(0);
    expect(await errorsFor({ password: 123 })).not.toHaveLength(0);
  });

  it('rejects an empty password', async () => {
    expect(await errorsFor({ password: '' })).not.toHaveLength(0);
  });

  it('rejects an empty body', async () => {
    expect(await errorsFor({})).not.toHaveLength(0);
  });

  it('rejects an incomplete or unknown social re-auth', async () => {
    expect(await errorsFor({ provider: 'google' })).not.toHaveLength(0);
    expect(
      await errorsFor({ provider: 'evil', idToken: 't', nonce: 'n' }),
    ).not.toHaveLength(0);
    expect(await errorsFor({ idToken: 't', nonce: 'n' })).not.toHaveLength(0);
  });
});
