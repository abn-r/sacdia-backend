import { ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../config/i18n-validation-details';
import { CreateDirectorDependentDto } from './create-director-dependent.dto';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

async function validate(value: unknown) {
  try {
    return {
      ok: true as const,
      value: (await pipe.transform(value, {
        type: 'body',
        metatype: CreateDirectorDependentDto,
      })) as CreateDirectorDependentDto,
    };
  } catch {
    return { ok: false as const };
  }
}

const valid = {
  name: ' Luis ',
  paternal_last_name: 'Pérez',
  maternal_last_name: 'López',
  birthday: '2016-02-10',
  gender: 'M',
  sworn_declaration: true,
  accepted_terms_version: ' 2.0.0-family ',
  accepted_privacy_version: '2.0.0-family',
};

describe('CreateDirectorDependentDto (POST /club-sections/:id/dependents)', () => {
  it('accepts the documented payload and trims text and versions', async () => {
    const result = await validate(valid);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Luis');
      expect(result.value.accepted_terms_version).toBe('2.0.0-family');
      expect(result.value.gender).toBe('M');
    }
  });

  it('maternal_last_name and gender are optional', async () => {
    const { maternal_last_name, gender, ...rest } = valid;
    void maternal_last_name;
    void gender;

    expect((await validate(rest)).ok).toBe(true);
  });

  it.each(['name', 'paternal_last_name', 'birthday'] as const)(
    'requires %s',
    async (field) => {
      expect((await validate({ ...valid, [field]: undefined })).ok).toBe(false);
    },
  );

  it('requires sworn_declaration to be exactly true (400 otherwise)', async () => {
    for (const sworn of [false, 'true', 1, undefined]) {
      expect((await validate({ ...valid, sworn_declaration: sworn })).ok).toBe(
        false,
      );
    }
  });

  it('requires both accepted versions', async () => {
    expect(
      (await validate({ ...valid, accepted_terms_version: undefined })).ok,
    ).toBe(false);
    expect(
      (await validate({ ...valid, accepted_privacy_version: undefined })).ok,
    ).toBe(false);
  });

  it('rejects a malformed birthday', async () => {
    for (const birthday of ['10/02/2016', '2016-2-1', '', 20160210]) {
      expect((await validate({ ...valid, birthday })).ok).toBe(false);
    }
  });

  it('rejects a gender outside M/F and over-long names', async () => {
    expect((await validate({ ...valid, gender: 'X' })).ok).toBe(false);
    expect((await validate({ ...valid, name: 'a'.repeat(51) })).ok).toBe(false);
  });

  it.each([
    ['email', 'luis@example.com'],
    ['access_mode', 'supervised_login'],
    ['account', { password: 'x' }],
    ['password', 'Secret123!'],
    ['relationship_type_id', '22222222-2222-4222-8222-222222222222'],
    ['club_section_id', 5],
  ])(
    'rejects the unknown key %s with a 400 instead of storing it',
    async (key, value) => {
      expect((await validate({ ...valid, [key]: value })).ok).toBe(false);
    },
  );
});
