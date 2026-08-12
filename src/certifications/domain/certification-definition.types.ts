/**
 * Pure domain types for the configurable certifications engine.
 * Controllers and Prisma adapters must not invent transitions or status vocab.
 */

export const CERTIFICATION_VERSION_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'RETIRED',
] as const;
export type CertificationVersionStatus =
  (typeof CERTIFICATION_VERSION_STATUSES)[number];

export const CERTIFICATION_ENROLLMENT_STATUSES = [
  'ENROLLED',
  'IN_PROGRESS',
  'READY_FOR_CLOSEOUT',
  'SUBMITTED_FOR_FINAL_REVIEW',
  'APPROVED',
  'CERTIFIED',
  'WITHDRAWN',
  'EXPIRED',
  'CHANGES_REQUESTED',
] as const;
export type CertificationEnrollmentStatus =
  (typeof CERTIFICATION_ENROLLMENT_STATUSES)[number];

export const CERTIFICATION_REQUIREMENT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
] as const;
export type CertificationRequirementStatus =
  (typeof CERTIFICATION_REQUIREMENT_STATUSES)[number];

export const CERTIFICATION_COMPONENT_TYPES = [
  'TEXT_RESPONSE',
  'FILE_EVIDENCE',
  'LINKED_HONOR',
  'LINKED_ACTIVITY',
  'ATTESTATION',
  'AUTO_VALIDATION',
] as const;
export type CertificationComponentType =
  (typeof CERTIFICATION_COMPONENT_TYPES)[number];

export const CERTIFICATION_ELIGIBILITY_RULE_TYPES = [
  'MIN_AGE',
  'BAPTIZED',
  'INVESTED_CLASS',
  'ACTIVE_CLUB_TYPE',
  'ACTIVE_ROLE',
] as const;
export type CertificationEligibilityRuleType =
  (typeof CERTIFICATION_ELIGIBILITY_RULE_TYPES)[number];

export type RequirementProgressSnapshot = {
  requirementId: number;
  required: boolean;
  status: CertificationRequirementStatus;
};

export type ProgressSummary = {
  requiredTotal: number;
  requiredApproved: number;
  optionalTotal: number;
  optionalApproved: number;
  percentComplete: number;
  allRequiredApproved: boolean;
};
