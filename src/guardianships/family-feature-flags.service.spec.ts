import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { FamilyFeatureFlagsService } from './family-feature-flags.service';

function build(values: Record<string, unknown>): FamilyFeatureFlagsService {
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new FamilyFeatureFlagsService(config);
}

describe('FamilyFeatureFlagsService', () => {
  it('defaults every flag to false when the env is empty', () => {
    expect(build({}).getAll()).toEqual({
      teen_login: false,
      linked_device: false,
      director_create_minor: false,
    });
  });

  it('reads each flag from its own variable (boolean or "true")', () => {
    const service = build({
      FAMILY_TEEN_LOGIN_ENABLED: true,
      FAMILY_LINKED_DEVICE_ENABLED: 'true',
      FAMILY_DIRECTOR_CREATE_MINOR_ENABLED: false,
    });
    expect(service.getAll()).toEqual({
      teen_login: true,
      linked_device: true,
      director_create_minor: false,
    });
  });

  it('treats unknown strings as off', () => {
    expect(
      build({ FAMILY_TEEN_LOGIN_ENABLED: 'yes' }).isEnabled('teen_login'),
    ).toBe(false);
  });

  it('assertEnabled passes when on and throws 404 FAMILY_FEATURE_DISABLED when off', () => {
    const on = build({ FAMILY_TEEN_LOGIN_ENABLED: true });
    expect(() => on.assertEnabled('teen_login')).not.toThrow();

    const off = build({});
    try {
      off.assertEnabled('teen_login');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe(
        ErrorCode.FAMILY_FEATURE_DISABLED,
      );
      expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });
});
