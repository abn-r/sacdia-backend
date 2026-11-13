import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export type FamilyFeatureFlag =
  'teen_login' | 'linked_device' | 'director_create_minor' | 'majority_release';

export interface FamilyFeatures {
  teen_login: boolean;
  linked_device: boolean;
  director_create_minor: boolean;
  majority_release: boolean;
}

const FLAG_ENV: Record<FamilyFeatureFlag, string> = {
  teen_login: 'FAMILY_TEEN_LOGIN_ENABLED',
  linked_device: 'FAMILY_LINKED_DEVICE_ENABLED',
  director_create_minor: 'FAMILY_DIRECTOR_CREATE_MINOR_ENABLED',
  majority_release: 'FAMILY_MAJORITY_RELEASE_ENABLED',
};

/**
 * Reads the family-profiles flags (Phase 3 and the Phase 4 majority release). The service itself caches
 * nothing (every call asks the ConfigService), but a deployed server reads the
 * environment validated at boot: flipping a flag in production needs a RESTART.
 * Only tests can flip one live, through `ConfigService.set`. The defaults are
 * all false. Joi converts the env value to a boolean; a raw 'true' string
 * (tests, or a config source that skipped validation) is accepted too.
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

  /** The booleans, as exposed in `/auth/me.family_features`. */
  getAll(): FamilyFeatures {
    return {
      teen_login: this.isEnabled('teen_login'),
      linked_device: this.isEnabled('linked_device'),
      director_create_minor: this.isEnabled('director_create_minor'),
      majority_release: this.isEnabled('majority_release'),
    };
  }

  /**
   * FAMILY_MAJORITY_RELEASE_DRY_RUN: the release cron computes and logs but
   * writes and sends nothing. Same restart-to-change semantics as the flags.
   */
  isMajorityReleaseDryRun(): boolean {
    const value: unknown = this.config.get('FAMILY_MAJORITY_RELEASE_DRY_RUN');
    return value === true || value === 'true';
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
