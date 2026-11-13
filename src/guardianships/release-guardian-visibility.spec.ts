import {
  ACTIVE_USER_GUARDIAN,
  GUARDIAN_MANAGED_DEPENDENT,
  NOT_REVOKED,
} from './guardianship-queries';

/**
 * Phase 4 (FP4-36/38): releasing a person revokes EVERY guardianship with reason
 * `released`. The guardian surfaces (list, detail, summary, security notices,
 * deletion impact, acting-for) all filter through these fragments, so the
 * released person disappears from all of them without per-surface code. This
 * pins the fragments so a refactor cannot silently re-expose a released adult.
 */
describe('released persons vanish from the guardian surfaces', () => {
  it('NOT_REVOKED excludes revoked rows (a released guardianship is revoked)', () => {
    expect(NOT_REVOKED).toEqual({ consent_status: { not: 'revoked' } });
  });

  it('ACTIVE_USER_GUARDIAN (summary, security notices, deletion impact) builds on NOT_REVOKED', () => {
    expect(ACTIVE_USER_GUARDIAN).toMatchObject({
      ...NOT_REVOKED,
      is_custodian: false,
      is_test_data: false,
    });
  });

  it('the managed-dependent fragment still requires a live (unfrozen, unpurged) profile', () => {
    expect(GUARDIAN_MANAGED_DEPENDENT.dependent_profile).toEqual({
      is: { frozen_at: null, purged_at: null },
    });
  });
});
