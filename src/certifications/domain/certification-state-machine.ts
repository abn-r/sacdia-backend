import { ErrorCode } from '../../common/errors/error-codes';
import {
  AppBadRequestException,
  AppConflictException,
} from '../../common/errors/app.exception';
import type {
  CertificationEnrollmentStatus,
  CertificationRequirementStatus,
  CertificationVersionStatus,
  ProgressSummary,
  RequirementProgressSnapshot,
} from './certification-definition.types';

const ENROLLMENT_TRANSITIONS: Record<
  CertificationEnrollmentStatus,
  ReadonlySet<CertificationEnrollmentStatus>
> = {
  ENROLLED: new Set([
    'IN_PROGRESS',
    'WITHDRAWN',
    'EXPIRED',
  ]),
  IN_PROGRESS: new Set([
    'READY_FOR_CLOSEOUT',
    'WITHDRAWN',
    'EXPIRED',
  ]),
  READY_FOR_CLOSEOUT: new Set([
    'SUBMITTED_FOR_FINAL_REVIEW',
    'IN_PROGRESS',
    'WITHDRAWN',
    'EXPIRED',
  ]),
  SUBMITTED_FOR_FINAL_REVIEW: new Set([
    'APPROVED',
    'CHANGES_REQUESTED',
    'EXPIRED',
  ]),
  CHANGES_REQUESTED: new Set([
    'IN_PROGRESS',
    'WITHDRAWN',
    'EXPIRED',
  ]),
  APPROVED: new Set(['CERTIFIED', 'EXPIRED']),
  CERTIFIED: new Set(),
  WITHDRAWN: new Set(),
  EXPIRED: new Set(),
};

const REQUIREMENT_TRANSITIONS: Record<
  CertificationRequirementStatus,
  ReadonlySet<CertificationRequirementStatus>
> = {
  DRAFT: new Set(['SUBMITTED']),
  SUBMITTED: new Set(['APPROVED', 'CHANGES_REQUESTED']),
  CHANGES_REQUESTED: new Set(['SUBMITTED']),
  APPROVED: new Set(),
};

const REQUIREMENT_EDIT_LOCKED: ReadonlySet<CertificationRequirementStatus> =
  new Set(['SUBMITTED', 'APPROVED']);

export function assertVersionMutable(
  status: CertificationVersionStatus,
): void {
  if (status !== 'DRAFT') {
    throw new AppConflictException(ErrorCode.CERT_VERSION_IMMUTABLE);
  }
}

export function assertVersionPublished(
  status: CertificationVersionStatus,
): void {
  if (status !== 'PUBLISHED') {
    throw new AppBadRequestException(ErrorCode.CERT_VERSION_NOT_PUBLISHED);
  }
}

export function canTransitionEnrollment(
  from: CertificationEnrollmentStatus,
  to: CertificationEnrollmentStatus,
): boolean {
  return ENROLLMENT_TRANSITIONS[from]?.has(to) ?? false;
}

export function transitionEnrollment(
  from: CertificationEnrollmentStatus,
  to: CertificationEnrollmentStatus,
): CertificationEnrollmentStatus {
  if (!canTransitionEnrollment(from, to)) {
    throw new AppBadRequestException(ErrorCode.CERT_INVALID_TRANSITION, {
      from,
      to,
      entity: 'enrollment',
    });
  }
  return to;
}

export function canTransitionRequirement(
  from: CertificationRequirementStatus,
  to: CertificationRequirementStatus,
): boolean {
  return REQUIREMENT_TRANSITIONS[from]?.has(to) ?? false;
}

export function transitionRequirement(
  from: CertificationRequirementStatus,
  to: CertificationRequirementStatus,
): CertificationRequirementStatus {
  if (!canTransitionRequirement(from, to)) {
    throw new AppBadRequestException(ErrorCode.CERT_INVALID_TRANSITION, {
      from,
      to,
      entity: 'requirement',
    });
  }
  return to;
}

export function assertRequirementEditable(
  status: CertificationRequirementStatus,
): void {
  if (REQUIREMENT_EDIT_LOCKED.has(status)) {
    throw new AppConflictException(ErrorCode.CERT_REQUIREMENT_LOCKED, {
      status,
    });
  }
}

export function computeProgressSummary(
  requirements: RequirementProgressSnapshot[],
): ProgressSummary {
  const required = requirements.filter((r) => r.required);
  const optional = requirements.filter((r) => !r.required);
  const requiredApproved = required.filter((r) => r.status === 'APPROVED');
  const optionalApproved = optional.filter((r) => r.status === 'APPROVED');
  const requiredTotal = required.length;
  const percentComplete =
    requiredTotal === 0
      ? 100
      : Math.round((requiredApproved.length / requiredTotal) * 100);

  return {
    requiredTotal,
    requiredApproved: requiredApproved.length,
    optionalTotal: optional.length,
    optionalApproved: optionalApproved.length,
    percentComplete,
    allRequiredApproved:
      requiredTotal > 0 && requiredApproved.length === requiredTotal,
  };
}

export function assertReadyForCloseout(
  requirements: RequirementProgressSnapshot[],
): void {
  const summary = computeProgressSummary(requirements);
  if (!summary.allRequiredApproved) {
    throw new AppBadRequestException(ErrorCode.CERT_CLOSEOUT_INCOMPLETE, {
      requiredTotal: summary.requiredTotal,
      requiredApproved: summary.requiredApproved,
    });
  }
}
