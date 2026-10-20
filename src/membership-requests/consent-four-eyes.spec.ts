import { ErrorCode } from '../common/errors/error-codes';
import {
  CUSTODY_TRIGGER_REASONS,
  consentHasVerifyWork,
  custodyBarredUserIds,
  evaluateConsentVerifier,
  verdictHasVerifyWork,
  verifierBlockErrorCode,
} from './consent-four-eyes';

const VIEWER = 'viewer-0000-4000-8000-000000000001';
const OTHER = 'other-00000-4000-8000-000000000002';

const base = {
  viewerId: VIEWER,
  hasPrimary: true,
  consentStatus: 'pending' as const,
  evidenceUploaded: true,
  viewerIsLiveGuardian: false,
  custody: true,
  custodyBarredUserIds: [OTHER],
};

describe('consent four-eyes predicate (shared by verify-consent and the consent block)', () => {
  it('lets an independent reviewer verify: can verify, no block', () => {
    expect(evaluateConsentVerifier(base)).toEqual({
      viewer_can_verify: true,
      viewer_verify_block: null,
    });
  });

  it('a live guardian is blocked as self_guardian on a guardian row too', () => {
    expect(
      evaluateConsentVerifier({
        ...base,
        custody: false,
        custodyBarredUserIds: [],
        viewerIsLiveGuardian: true,
      }),
    ).toEqual({
      viewer_can_verify: false,
      viewer_verify_block: 'self_guardian',
    });
  });

  it('a barred custodian (creator, uploader or handed-over guardian) is blocked as self_custodian', () => {
    expect(
      evaluateConsentVerifier({
        ...base,
        custodyBarredUserIds: [OTHER, VIEWER],
      }),
    ).toEqual({
      viewer_can_verify: false,
      viewer_verify_block: 'self_custodian',
    });
  });

  it('the custody list is ignored on a guardian-managed row (ruling A14 is custody only)', () => {
    expect(
      evaluateConsentVerifier({
        ...base,
        custody: false,
        custodyBarredUserIds: [VIEWER],
      }),
    ).toEqual({ viewer_can_verify: true, viewer_verify_block: null });
  });

  it('guardian wins over custodian when both apply (same order as verify-consent)', () => {
    expect(
      evaluateConsentVerifier({
        ...base,
        viewerIsLiveGuardian: true,
        custodyBarredUserIds: [VIEWER],
      }).viewer_verify_block,
    ).toBe('self_guardian');
  });

  it.each([
    ['no primary row', { hasPrimary: false }],
    ['already verified', { consentStatus: 'verified' as const }],
    ['no form uploaded', { evidenceUploaded: false }],
  ])(
    '%s: nothing to verify, so false and no block even for a barred viewer',
    (_n, patch) => {
      expect(
        evaluateConsentVerifier({
          ...base,
          viewerIsLiveGuardian: true,
          custodyBarredUserIds: [VIEWER],
          ...patch,
        }),
      ).toEqual({ viewer_can_verify: false, viewer_verify_block: null });
    },
  );

  it('maps each block to the error code verify-consent throws', () => {
    expect(verifierBlockErrorCode('self_guardian')).toBe(
      ErrorCode.GUARDIANSHIP_GUARDIAN_SELF_VERIFY,
    );
    expect(verifierBlockErrorCode('self_custodian')).toBe(
      ErrorCode.GUARDIANSHIP_CUSTODIAN_SELF_VERIFY,
    );
  });

  it('collects uploader, creator and handed-over guardian and drops the empty ones', () => {
    expect(
      custodyBarredUserIds({
        evidenceUploaderId: 'u',
        creatorId: null,
        handedOverGuardianId: 'h',
      }).sort(),
    ).toEqual(['h', 'u']);
    expect(
      custodyBarredUserIds({
        evidenceUploaderId: 'u',
        creatorId: 'c',
        handedOverGuardianId: undefined,
      }).sort(),
    ).toEqual(['c', 'u']);
  });

  it('keeps the hand-over trigger reasons', () => {
    expect([...CUSTODY_TRIGGER_REASONS]).toEqual([
      'guardian_left',
      'guardian_account_closed',
    ]);
  });
});

describe('consent has work for a verifier (what a verify-only reviewer is shown)', () => {
  it.each([
    ['pending consent with a current form', true, 'pending', true, true],
    ['no form uploaded yet', true, 'pending', false, false],
    ['already verified', true, 'verified', true, false],
    ['revoked', true, 'revoked', true, false],
    [
      'no active primary row (nothing to verify)',
      false,
      'pending',
      true,
      false,
    ],
  ])('%s', (_label, hasPrimary, consentStatus, evidenceUploaded, expected) => {
    expect(
      consentHasVerifyWork({ hasPrimary, consentStatus, evidenceUploaded }),
    ).toBe(expected);
  });

  it('is exactly the "something to verify" half of the verdict, barred viewer or not', () => {
    const cases = [];
    for (const hasPrimary of [true, false]) {
      for (const consentStatus of ['pending', 'verified', 'revoked']) {
        for (const evidenceUploaded of [true, false]) {
          for (const viewerIsLiveGuardian of [true, false]) {
            for (const custody of [true, false]) {
              cases.push({
                viewerId: VIEWER,
                hasPrimary,
                consentStatus,
                evidenceUploaded,
                viewerIsLiveGuardian,
                custody,
                custodyBarredUserIds: [VIEWER],
              });
            }
          }
        }
      }
    }
    for (const input of cases) {
      expect(verdictHasVerifyWork(evaluateConsentVerifier(input))).toBe(
        consentHasVerifyWork(input),
      );
    }
  });

  it('a barred viewer still has work shown (the block explains why they cannot act)', () => {
    expect(
      verdictHasVerifyWork({
        viewer_can_verify: false,
        viewer_verify_block: 'self_custodian',
      }),
    ).toBe(true);
    expect(
      verdictHasVerifyWork({
        viewer_can_verify: false,
        viewer_verify_block: null,
      }),
    ).toBe(false);
  });
});
