import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

const base = {
  name: 'Juan',
  paternal_last_name: 'García',
  maternal_last_name: 'López',
  email: 'juan.garcia@example.com',
  password: 'Password123!',
  accepted_terms_version: '1.0.0-store',
  accepted_privacy_version: '1.0.0-store',
};

async function errorsFor(body: Record<string, unknown>) {
  return validate(plainToInstance(RegisterDto, body));
}

describe('RegisterDto legal versions', () => {
  it('accepts a body carrying both versions', async () => {
    expect(await errorsFor(base)).toHaveLength(0);
  });

  it('trims the versions', () => {
    const dto = plainToInstance(RegisterDto, {
      ...base,
      accepted_terms_version: ' 1.0.0-store ',
      accepted_privacy_version: '\t1.0.0-store\n',
    });
    expect(dto.accepted_terms_version).toBe('1.0.0-store');
    expect(dto.accepted_privacy_version).toBe('1.0.0-store');
  });

  it.each(['accepted_terms_version', 'accepted_privacy_version'])(
    'rejects a body without %s',
    async (field) => {
      const { [field]: _omitted, ...rest } = base as Record<string, unknown>;
      const errors = await errorsFor(rest);
      expect(errors.map((e) => e.property)).toContain(field);
    },
  );

  it.each(['accepted_terms_version', 'accepted_privacy_version'])(
    'rejects blank, non-string and over-long %s',
    async (field) => {
      for (const bad of ['', '   ', 5, null, 'x'.repeat(33)]) {
        const errors = await errorsFor({ ...base, [field]: bad });
        expect(errors.map((e) => e.property)).toContain(field);
      }
    },
  );
});

describe('RegisterDto birthday and country_id (age gate)', () => {
  it('stays valid without birthday and country_id (optional server-side)', async () => {
    expect(await errorsFor(base)).toHaveLength(0);
  });

  it('accepts a YYYY-MM-DD birthday and an integer country_id', async () => {
    expect(
      await errorsFor({ ...base, birthday: '2005-04-02', country_id: 1 }),
    ).toHaveLength(0);
  });

  it.each(['2005-4-2', '2005/04/02', '2005-02-31', '2005-04-02T00:00:00Z', ''])(
    'rejects the birthday %j',
    async (birthday) => {
      const errors = await errorsFor({ ...base, birthday });
      expect(errors.map((e) => e.property)).toContain('birthday');
    },
  );

  it('rejects a non-integer country_id', async () => {
    const errors = await errorsFor({ ...base, country_id: 'mx' });
    expect(errors.map((e) => e.property)).toContain('country_id');
  });
});
