export const CLUB_ENROLLMENT_STATUS = {
  PENDING_VALIDATION: 'pending_validation',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  INACTIVE: 'inactive',
} as const;

export type ClubEnrollmentStatus =
  (typeof CLUB_ENROLLMENT_STATUS)[keyof typeof CLUB_ENROLLMENT_STATUS];

/** Statuses the validation queue can show (`inactive` is not part of the review). */
export const CLUB_ENROLLMENT_REVIEW_STATUSES = [
  CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION,
  CLUB_ENROLLMENT_STATUS.ACTIVE,
  CLUB_ENROLLMENT_STATUS.REJECTED,
] as const;
export type ClubEnrollmentReviewStatus =
  (typeof CLUB_ENROLLMENT_REVIEW_STATUSES)[number];

export const CLUB_ENROLLMENT_REVIEW_PERMISSION = 'club_enrollments:validate';

/** Notification source for the approve / reject push + inbox. */
export const CLUB_ENROLLMENT_REVIEW_SOURCE = 'club-enrollments:reviewed';
