import { enrollmentOnLegacyInvestiturePipeline } from './investiture-request-lock';

describe('enrollmentOnLegacyInvestiturePipeline after phase 8', () => {
  it.each([
    'SUBMITTED_FOR_VALIDATION',
    'CLUB_APPROVED',
    'COORDINATOR_APPROVED',
    'FIELD_APPROVED',
    'APPROVED',
  ])('blocks %s while locked and lets it through once released', (status) => {
    expect(
      enrollmentOnLegacyInvestiturePipeline({
        investiture_status: status,
        locked_for_validation: true,
      }),
    ).toBe(true);
    expect(
      enrollmentOnLegacyInvestiturePipeline({
        investiture_status: status,
        locked_for_validation: false,
      }),
    ).toBe(false);
    expect(
      enrollmentOnLegacyInvestiturePipeline({ investiture_status: status }),
    ).toBe(false);
  });
});
