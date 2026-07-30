import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import {
  type TimezoneClassification,
  loadCanonicalGeographicIanaTimezoneCatalog,
} from '../timezone/canonical-geographic-iana-timezone';

let localFieldTimezoneCatalog: ReturnType<
  typeof loadCanonicalGeographicIanaTimezoneCatalog
> | undefined;

export function classifyLocalFieldTimezone(
  value: unknown,
): TimezoneClassification {
  localFieldTimezoneCatalog ??= loadCanonicalGeographicIanaTimezoneCatalog();
  return localFieldTimezoneCatalog.classify(value);
}

export function isCanonicalLocalFieldTimezone(value: unknown): value is string {
  return classifyLocalFieldTimezone(value).ok;
}

export function isIanaTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

@ValidatorConstraint({ name: 'isIanaTimezone', async: false })
export class IsIanaTimezoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isIanaTimezone(value);
  }

  defaultMessage(): string {
    return 'timezone must be a supported IANA timezone';
  }
}

@ValidatorConstraint({ name: 'isCanonicalLocalFieldTimezone', async: false })
export class IsCanonicalLocalFieldTimezoneConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    return value === null || value === undefined || isCanonicalLocalFieldTimezone(value);
  }

  defaultMessage(): string {
    return 'timezone must be a canonical geographic IANA timezone';
  }
}
