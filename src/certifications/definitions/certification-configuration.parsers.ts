/**
 * Typed parsers for the JSONB `configuration` blobs stored on
 * certification_eligibility_rules and certification_requirement_components.
 *
 * These are intentionally strict: unknown keys are rejected so that admin
 * mistakes fail fast instead of silently persisting dead configuration.
 * Domain services must go through these parsers before writing DRAFT trees.
 */
import { BadRequestException } from '@nestjs/common';
import type {
  CertificationComponentType,
  CertificationEligibilityRuleType,
} from '../domain/certification-definition.types';

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertObjectShape(
  value: unknown,
  allowedKeys: readonly string[],
  context: string,
): JsonObject {
  const candidate = value ?? {};
  if (!isPlainObject(candidate)) {
    throw new BadRequestException(
      `${context}: configuration must be an object`,
    );
  }

  const unknownKeys = Object.keys(candidate).filter(
    (key) => !allowedKeys.includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new BadRequestException(
      `${context}: unknown configuration key(s): ${unknownKeys.join(', ')}`,
    );
  }

  return candidate;
}

// ============================================================================
// Eligibility rule configuration
// ============================================================================

export type MinAgeRuleConfig = { min_age: number };
export type EmptyRuleConfig = Record<string, never>;

export type EligibilityRuleConfigMap = {
  MIN_AGE: MinAgeRuleConfig;
  BAPTIZED: EmptyRuleConfig;
  INVESTED_CLASS: EmptyRuleConfig;
  ACTIVE_CLUB_TYPE: EmptyRuleConfig;
  ACTIVE_ROLE: EmptyRuleConfig;
};

const ELIGIBILITY_RULE_ALLOWED_KEYS: Record<
  CertificationEligibilityRuleType,
  readonly string[]
> = {
  MIN_AGE: ['min_age'],
  BAPTIZED: [],
  INVESTED_CLASS: [],
  ACTIVE_CLUB_TYPE: [],
  ACTIVE_ROLE: [],
};

type EligibilityRuleForeignKey = 'class_id' | 'club_type_id' | 'role_id';

const ELIGIBILITY_RULE_REQUIRED_FK: Record<
  CertificationEligibilityRuleType,
  EligibilityRuleForeignKey | null
> = {
  MIN_AGE: null,
  BAPTIZED: null,
  INVESTED_CLASS: 'class_id',
  ACTIVE_CLUB_TYPE: 'club_type_id',
  ACTIVE_ROLE: 'role_id',
};

export function parseEligibilityRuleConfiguration<
  T extends CertificationEligibilityRuleType,
>(ruleType: T, configuration: unknown): EligibilityRuleConfigMap[T] {
  const allowedKeys = ELIGIBILITY_RULE_ALLOWED_KEYS[ruleType];
  const parsed = assertObjectShape(
    configuration,
    allowedKeys,
    `eligibility rule "${ruleType}"`,
  );

  if (ruleType === 'MIN_AGE') {
    const minAge = parsed.min_age;
    if (typeof minAge !== 'number' || !Number.isInteger(minAge) || minAge < 0) {
      throw new BadRequestException(
        'eligibility rule "MIN_AGE": min_age must be a non-negative integer',
      );
    }
  }

  return parsed as EligibilityRuleConfigMap[T];
}

export type EligibilityRuleInput = {
  rule_type: CertificationEligibilityRuleType;
  configuration?: unknown;
  class_id?: number | null;
  club_type_id?: number | null;
  role_id?: string | null;
  sort_order?: number;
};

export type ParsedEligibilityRule = {
  rule_type: CertificationEligibilityRuleType;
  configuration: JsonObject;
  class_id: number | null;
  club_type_id: number | null;
  role_id: string | null;
  sort_order: number;
};

const ELIGIBILITY_FK_KEYS: readonly EligibilityRuleForeignKey[] = [
  'class_id',
  'club_type_id',
  'role_id',
];

export function parseEligibilityRuleInput(
  input: EligibilityRuleInput,
  index = 0,
): ParsedEligibilityRule {
  const configuration = parseEligibilityRuleConfiguration(
    input.rule_type,
    input.configuration,
  );

  const requiredFk = ELIGIBILITY_RULE_REQUIRED_FK[input.rule_type];
  const fkValues: Record<EligibilityRuleForeignKey, number | string | null> = {
    class_id: input.class_id ?? null,
    club_type_id: input.club_type_id ?? null,
    role_id: input.role_id ?? null,
  };

  if (requiredFk && !fkValues[requiredFk]) {
    throw new BadRequestException(
      `eligibility rule "${input.rule_type}": ${requiredFk} is required`,
    );
  }

  for (const key of ELIGIBILITY_FK_KEYS) {
    if (key !== requiredFk && fkValues[key] !== null) {
      throw new BadRequestException(
        `eligibility rule "${input.rule_type}": ${key} must not be set`,
      );
    }
  }

  return {
    rule_type: input.rule_type,
    configuration,
    class_id: fkValues.class_id as number | null,
    club_type_id: fkValues.club_type_id as number | null,
    role_id: fkValues.role_id as string | null,
    sort_order: input.sort_order ?? index,
  };
}

// ============================================================================
// Requirement component configuration
// ============================================================================

export type TextResponseComponentConfig = {
  min_length?: number;
  max_length?: number;
};
export type FileEvidenceComponentConfig = {
  max_files?: number;
  allowed_mime_types?: string[];
};
export type AttestationComponentConfig = { statement: string };
export type AutoValidationComponentConfig = { criteria: string };

export type ComponentConfigMap = {
  TEXT_RESPONSE: TextResponseComponentConfig;
  FILE_EVIDENCE: FileEvidenceComponentConfig;
  LINKED_HONOR: EmptyRuleConfig;
  LINKED_ACTIVITY: EmptyRuleConfig;
  ATTESTATION: AttestationComponentConfig;
  AUTO_VALIDATION: AutoValidationComponentConfig;
};

const COMPONENT_ALLOWED_KEYS: Record<
  CertificationComponentType,
  readonly string[]
> = {
  TEXT_RESPONSE: ['min_length', 'max_length'],
  FILE_EVIDENCE: ['max_files', 'allowed_mime_types'],
  LINKED_HONOR: [],
  LINKED_ACTIVITY: [],
  ATTESTATION: ['statement'],
  AUTO_VALIDATION: ['criteria'],
};

export function parseComponentConfiguration<
  T extends CertificationComponentType,
>(componentType: T, configuration: unknown): ComponentConfigMap[T] {
  const allowedKeys = COMPONENT_ALLOWED_KEYS[componentType];
  const parsed = assertObjectShape(
    configuration,
    allowedKeys,
    `component "${componentType}"`,
  );

  switch (componentType) {
    case 'TEXT_RESPONSE': {
      for (const key of ['min_length', 'max_length'] as const) {
        const value = parsed[key];
        if (value !== undefined && (typeof value !== 'number' || value < 0)) {
          throw new BadRequestException(
            `component "TEXT_RESPONSE": ${key} must be a non-negative number`,
          );
        }
      }
      if (
        typeof parsed.min_length === 'number' &&
        typeof parsed.max_length === 'number' &&
        parsed.max_length < parsed.min_length
      ) {
        throw new BadRequestException(
          'component "TEXT_RESPONSE": max_length must be greater than or equal to min_length',
        );
      }
      break;
    }
    case 'FILE_EVIDENCE': {
      if (
        parsed.max_files !== undefined &&
        (typeof parsed.max_files !== 'number' || parsed.max_files < 1)
      ) {
        throw new BadRequestException(
          'component "FILE_EVIDENCE": max_files must be a positive number',
        );
      }
      if (
        parsed.allowed_mime_types !== undefined &&
        (!Array.isArray(parsed.allowed_mime_types) ||
          !parsed.allowed_mime_types.every((v) => typeof v === 'string'))
      ) {
        throw new BadRequestException(
          'component "FILE_EVIDENCE": allowed_mime_types must be an array of strings',
        );
      }
      break;
    }
    case 'ATTESTATION': {
      if (
        typeof parsed.statement !== 'string' ||
        parsed.statement.trim().length === 0
      ) {
        throw new BadRequestException(
          'component "ATTESTATION": statement is required',
        );
      }
      break;
    }
    case 'AUTO_VALIDATION': {
      if (
        typeof parsed.criteria !== 'string' ||
        parsed.criteria.trim().length === 0
      ) {
        throw new BadRequestException(
          'component "AUTO_VALIDATION": criteria is required',
        );
      }
      break;
    }
    default:
      break;
  }

  return parsed as ComponentConfigMap[T];
}

export type ComponentInput = {
  component_type: CertificationComponentType;
  label: string;
  instructions?: string | null;
  configuration?: unknown;
  sort_order?: number;
  required?: boolean;
  honor_id?: number | null;
  activity_type_id?: number | null;
};

export type ParsedComponent = {
  component_type: CertificationComponentType;
  label: string;
  instructions: string | null;
  configuration: JsonObject;
  sort_order: number;
  required: boolean;
  honor_id: number | null;
  activity_type_id: number | null;
};

type ComponentForeignKey = 'honor_id' | 'activity_type_id';

const COMPONENT_REQUIRED_FK: Record<
  CertificationComponentType,
  ComponentForeignKey | null
> = {
  TEXT_RESPONSE: null,
  FILE_EVIDENCE: null,
  LINKED_HONOR: 'honor_id',
  LINKED_ACTIVITY: 'activity_type_id',
  ATTESTATION: null,
  AUTO_VALIDATION: null,
};

export function parseComponentInput(
  input: ComponentInput,
  index = 0,
): ParsedComponent {
  const configuration = parseComponentConfiguration(
    input.component_type,
    input.configuration,
  );

  const requiredFk = COMPONENT_REQUIRED_FK[input.component_type];
  const honorId = input.honor_id ?? null;
  const activityTypeId = input.activity_type_id ?? null;

  if (requiredFk === 'honor_id' && !honorId) {
    throw new BadRequestException(
      `component "${input.component_type}": honor_id is required`,
    );
  }
  if (requiredFk === 'activity_type_id' && !activityTypeId) {
    throw new BadRequestException(
      `component "${input.component_type}": activity_type_id is required`,
    );
  }
  if (requiredFk !== 'honor_id' && honorId !== null) {
    throw new BadRequestException(
      `component "${input.component_type}": honor_id must not be set`,
    );
  }
  if (requiredFk !== 'activity_type_id' && activityTypeId !== null) {
    throw new BadRequestException(
      `component "${input.component_type}": activity_type_id must not be set`,
    );
  }

  if (!input.label || input.label.trim().length === 0) {
    throw new BadRequestException('component: label is required');
  }

  return {
    component_type: input.component_type,
    label: input.label,
    instructions: input.instructions ?? null,
    configuration,
    sort_order: input.sort_order ?? index,
    required: input.required ?? true,
    honor_id: honorId,
    activity_type_id: activityTypeId,
  };
}
