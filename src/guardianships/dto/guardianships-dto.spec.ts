import { ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../config/i18n-validation-details';
import {
  CreateDependentDto,
  IssueLinkCodeDto,
  RedeemLinkCodeDto,
  RevokeGuardianshipDto,
} from './index';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

async function validate<T>(type: new () => T, value: unknown) {
  try {
    return {
      ok: true as const,
      value: (await pipe.transform(value, {
        type: 'body',
        metatype: type,
      })) as T,
    };
  } catch {
    return { ok: false as const };
  }
}

const REL = '22222222-2222-4222-8222-222222222222';
const validDependent = {
  name: ' Ana ',
  paternal_last_name: 'Pérez',
  birthday: '2017-04-02',
  relationship_type_id: REL,
  sworn_declaration: true,
  accepted_terms_version: ' 2.0.0-family ',
  accepted_privacy_version: '2.0.0-family',
};

describe('CreateDependentDto', () => {
  it('accepts the documented payload and trims text', async () => {
    const result = await validate(CreateDependentDto, validDependent);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Ana');
      expect(result.value.accepted_terms_version).toBe('2.0.0-family');
      expect(result.value.maternal_last_name).toBeUndefined();
    }
  });

  it('requires sworn_declaration to be exactly true', async () => {
    for (const sworn of [false, 'true', 1, undefined]) {
      expect(
        (
          await validate(CreateDependentDto, {
            ...validDependent,
            sworn_declaration: sworn,
          })
        ).ok,
      ).toBe(false);
    }
  });

  it.each(['access_mode', 'email', 'user_id'])(
    'rejects a client that sends %s (never stored)',
    async (field) => {
      expect(
        (
          await validate(CreateDependentDto, {
            ...validDependent,
            [field]: 'guardian_managed',
          })
        ).ok,
      ).toBe(false);
    },
  );

  it.each(['2017-4-2', '02/04/2017', '2017-04-02T00:00:00Z', ''])(
    'rejects the birthday %j',
    async (birthday) => {
      expect(
        (await validate(CreateDependentDto, { ...validDependent, birthday }))
          .ok,
      ).toBe(false);
    },
  );

  it('rejects a non UUID relationship', async () => {
    expect(
      (
        await validate(CreateDependentDto, {
          ...validDependent,
          relationship_type_id: 'madre',
        })
      ).ok,
    ).toBe(false);
  });
});

describe('IssueLinkCodeDto', () => {
  it('accepts second_guardian only', async () => {
    expect(
      (await validate(IssueLinkCodeDto, { purpose: 'second_guardian' })).ok,
    ).toBe(true);
    for (const purpose of ['linked_device', 'director_claim', '', undefined]) {
      expect((await validate(IssueLinkCodeDto, { purpose })).ok).toBe(false);
    }
  });
});

describe('RedeemLinkCodeDto', () => {
  const valid = {
    code: '7KQ4-M9TX',
    relationship_type_id: REL,
    sworn_declaration: true,
  };

  it('accepts a valid payload', async () => {
    expect((await validate(RedeemLinkCodeDto, valid)).ok).toBe(true);
  });

  it('requires the sworn declaration, a code and a relationship', async () => {
    expect(
      (
        await validate(RedeemLinkCodeDto, {
          ...valid,
          sworn_declaration: false,
        })
      ).ok,
    ).toBe(false);
    expect((await validate(RedeemLinkCodeDto, { ...valid, code: '' })).ok).toBe(
      false,
    );
    expect(
      (await validate(RedeemLinkCodeDto, { ...valid, code: 'x'.repeat(33) }))
        .ok,
    ).toBe(false);
    expect(
      (
        await validate(RedeemLinkCodeDto, {
          ...valid,
          relationship_type_id: undefined,
        })
      ).ok,
    ).toBe(false);
  });
});

describe('RevokeGuardianshipDto', () => {
  it('only allows the two voluntary reasons', async () => {
    for (const reason of ['guardian_left', 'removed_by_primary']) {
      expect((await validate(RevokeGuardianshipDto, { reason })).ok).toBe(true);
    }
    for (const reason of ['guardian_account_closed', 'claimed', 'admin', '']) {
      expect((await validate(RevokeGuardianshipDto, { reason })).ok).toBe(
        false,
      );
    }
  });
});
