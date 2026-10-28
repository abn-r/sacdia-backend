import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../errors/error-codes';

/**
 * Minimal view of a class-validator / nestjs-i18n ValidationError tree. Only
 * `property`, `constraints` and `children` are read: `value` and `target`
 * are never copied into the response.
 */
export interface ValidationErrorNode {
  property?: string;
  constraints?: Record<string, string>;
  children?: ValidationErrorNode[];
}

export interface ValidationFieldError {
  field: string;
  message: string;
  /** class-validator constraint name; only exposed outside production. */
  constraint?: string;
}

export interface ValidationErrorBody {
  status: 'error';
  statusCode: number;
  code: ErrorCode;
  /** Localized, one entry per failed constraint (same order as `errors`). */
  message: string[];
  errors: ValidationFieldError[];
  timestamp: string;
  path: string;
}

export type ValidationTranslate = (
  key: string,
  args?: Record<string, unknown>,
) => string;

const CONSTRAINT_KEY_PREFIX = 'errors.VALIDATION.constraint.';
const FALLBACK_CONSTRAINT = 'invalid';
const MAX_FIELD_LENGTH = 100;

/**
 * class-validator constraint -> translation key suffix. Constraints not listed
 * here fall back to the generic "invalid" message.
 */
const CONSTRAINT_TO_KEY: Record<string, string> = {
  whitelistValidation: 'whitelistValidation',
  isDefined: 'isDefined',
  isNotEmpty: 'isNotEmpty',
  isNotEmptyObject: 'isNotEmpty',
  arrayNotEmpty: 'isNotEmpty',
  isString: 'isString',
  isEmail: 'isEmail',
  isEnum: 'isEnum',
  isIn: 'isEnum',
  isInt: 'isInt',
  isNumber: 'isNumber',
  isBoolean: 'isBoolean',
  isArray: 'isArray',
  isObject: 'isObject',
  isUUID: 'isUUID',
  isDate: 'isDate',
  isDateString: 'isDate',
  isISO8601: 'isDate',
  isUrl: 'isUrl',
  isPositive: 'isPositive',
  min: 'min',
  max: 'max',
  minLength: 'minLength',
  maxLength: 'maxLength',
  arrayMinSize: 'arrayMinSize',
  arrayMaxSize: 'arrayMaxSize',
  matches: 'matches',
  nestedValidation: 'nestedValidation',
  unknownValue: 'unknownValue',
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `message` is the stock English text class-validator generated for
 * `property` (as opposed to a DTO-authored `message:` or an i18n key already
 * resolved by nestjs-i18n, which must be kept untouched).
 */
export function isDefaultValidationMessage(
  property: string,
  constraint: string,
  message: string,
): boolean {
  // Whitelist / unknown-value messages cannot be customised per decorator.
  if (constraint === 'whitelistValidation' || constraint === 'unknownValue') {
    return true;
  }
  const p = escapeRegExp(property);
  return new RegExp(
    `^(?:each value in |nested property )?${p}(?:\\s|$)[\\s\\S]*\\b(?:must|should)\\b`,
  ).test(message);
}

/** Pulls interpolation args out of the stock English message. */
function extractArgs(
  property: string,
  constraint: string,
  message: string,
): Record<string, unknown> {
  const afterProperty = message.includes(property)
    ? message.slice(message.indexOf(property) + property.length)
    : message;
  const args: Record<string, unknown> = {};

  if (constraint === 'isEnum' || constraint === 'isIn') {
    const idx = afterProperty.indexOf(':');
    if (idx !== -1) args.values = afterProperty.slice(idx + 1).trim();
    return args;
  }

  const num = afterProperty.match(/-?\d+(?:\.\d+)?/);
  if (num) {
    args.min = num[0];
    args.max = num[0];
  }
  return args;
}

function localizeConstraint(
  property: string,
  constraint: string,
  rawMessage: string,
  translate: ValidationTranslate,
): string {
  if (!isDefaultValidationMessage(property, constraint, rawMessage)) {
    return rawMessage;
  }
  const suffix = CONSTRAINT_TO_KEY[constraint] ?? FALLBACK_CONSTRAINT;
  const args = { property, ...extractArgs(property, constraint, rawMessage) };
  const key = `${CONSTRAINT_KEY_PREFIX}${suffix}`;
  const translated = translate(key, args);
  if (translated && translated !== key) return translated;
  const fallbackKey = `${CONSTRAINT_KEY_PREFIX}${FALLBACK_CONSTRAINT}`;
  const fallback = translate(fallbackKey, { property });
  return fallback && fallback !== fallbackKey ? fallback : rawMessage;
}

function collect(
  nodes: ValidationErrorNode[],
  parentPath: string,
  translate: ValidationTranslate,
  exposeConstraints: boolean,
  out: ValidationFieldError[],
): void {
  for (const node of nodes) {
    const property = String(node.property ?? '').slice(0, MAX_FIELD_LENGTH);
    const field = parentPath ? `${parentPath}.${property}` : property;
    for (const [constraint, raw] of Object.entries(node.constraints ?? {})) {
      out.push({
        field,
        message: localizeConstraint(
          property,
          constraint,
          String(raw),
          translate,
        ),
        ...(exposeConstraints ? { constraint } : {}),
      });
    }
    if (node.children?.length) {
      collect(node.children, field, translate, exposeConstraints, out);
    }
  }
}

/**
 * Builds the single response shape for every class-validator failure:
 * `code: VALIDATION_FAILED`, localized `message[]` and a per-field `errors[]`
 * list. Never includes the rejected values or the request body.
 */
export function buildValidationErrorBody(params: {
  errors: ValidationErrorNode[];
  translate: ValidationTranslate;
  path: string;
  statusCode?: number;
  exposeConstraints?: boolean;
}): ValidationErrorBody {
  const errors: ValidationFieldError[] = [];
  collect(
    params.errors,
    '',
    params.translate,
    params.exposeConstraints ?? false,
    errors,
  );
  return {
    status: 'error',
    statusCode: params.statusCode ?? HttpStatus.BAD_REQUEST,
    code: ErrorCode.VALIDATION_FAILED,
    message: errors.map((e) => e.message),
    errors,
    timestamp: new Date().toISOString(),
    path: params.path,
  };
}
