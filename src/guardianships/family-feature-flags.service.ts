import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export type FamilyFeatureFlag =
  'teen_login' | 'linked_device' | 'director_create_minor';

export interface FamilyFeatures {
  teen_login: boolean;
  linked_device: boolean;
  director_create_minor: boolean;
}

const FLAG_ENV: Record<FamilyFeatureFlag, string> = {
  teen_login: 'FAMILY_TEEN_LOGIN_ENABLED',
  linked_device: 'FAMILY_LINKED_DEVICE_ENABLED',
  director_create_minor: 'FAMILY_DIRECTOR_CREATE_MINOR_ENABLED',
};

/**
 * Reads the three family-profiles Phase 3 flags. Values are read on every call
 * (never cached) so a flag flip takes effect without a restart in tests, and
 * the defaults are all false. Joi converts the env value to a boolean; a raw
 * 'true' string (tests, or a config source that skipped validation) is
 * accepted too.
 *
 * The consent gate, pending-guardian mode, teen link codes, security notices,
 * the guardian summary and the crons are NOT flagged on purpose: closing the
 * 13-17 consent hole is unconditional.
 */
@Injectable()
export class FamilyFeatureFlagsService {
  constructor(private readonly config: ConfigService) {}

  isEnabled(flag: FamilyFeatureFlag): boolean {
    const value: unknown = this.config.get(FLAG_ENV[flag]);
    return value === true || value === 'true';
  }

  /** The three booleans, as exposed in `/auth/me.family_features`. */
  getAll(): FamilyFeatures {
    return {
      teen_login: this.isEnabled('teen_login'),
      linked_device: this.isEnabled('linked_device'),
      director_create_minor: this.isEnabled('director_create_minor'),
    };
  }

  /** Throws 404 FAMILY_FEATURE_DISABLED when the flag is off. */
  assertEnabled(flag: FamilyFeatureFlag): void {
    if (!this.isEnabled(flag)) {
      throw new AppException(
        ErrorCode.FAMILY_FEATURE_DISABLED,
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
