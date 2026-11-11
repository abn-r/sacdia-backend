import { ErrorCode } from '../common/errors/error-codes';
import {
  SERVICE_ROLE_NAMES,
  effectiveMaxPerSection,
  evaluateServiceRoleAllowance,
  hasFreeSlot,
} from './club-role-rules';

const maxByRole = new Map<string, number | null>([
  ['deputy-director', 2],
  ['secretary', 1],
  ['treasurer', 1],
  ['secretary-treasurer', 1],
  ['counselor', null],
]);

const base = {
  isSelf: false,
  hasGmMembership: true,
  holdsRoleInTargetSection: false,
  consentBlocked: false,
  occupiedByRole: new Map<string, number>(),
  maxByRole,
};

describe('club-role-rules', () => {
  it('uses canonical limits when role_slot_limits has no row', () => {
    expect(effectiveMaxPerSection('deputy-director', undefined)).toBe(2);
    expect(effectiveMaxPerSection('counselor', null)).toBeNull();
    expect(effectiveMaxPerSection('secretary', 5)).toBe(5);
  });

  it('offers every service role when the section is empty and never director/member', () => {
    const result = evaluateServiceRoleAllowance(base);
    expect(result.blockedReason).toBeNull();
    expect(result.allowedRoles).toEqual([...SERVICE_ROLE_NAMES]);
    expect(result.allowedRoles).not.toContain('director');
    expect(result.allowedRoles).not.toContain('member');
  });

  it('subtracts roles whose slots are full', () => {
    const result = evaluateServiceRoleAllowance({
      ...base,
      occupiedByRole: new Map([
        ['deputy-director', 2],
        ['secretary', 1],
      ]),
    });
    expect(result.allowedRoles).not.toContain('deputy-director');
    expect(result.allowedRoles).not.toContain('secretary');
    expect(result.allowedRoles).toContain('treasurer');
    expect(result.allowedRoles).toContain('counselor');
  });

  it('applies secretary / treasurer vs secretary-treasurer exclusivity both ways', () => {
    expect(
      hasFreeSlot(
        'secretary-treasurer',
        new Map([['secretary', 1]]),
        maxByRole,
      ),
    ).toBe(false);
    expect(
      hasFreeSlot(
        'secretary-treasurer',
        new Map([['treasurer', 1]]),
        maxByRole,
      ),
    ).toBe(false);
    expect(
      hasFreeSlot(
        'treasurer',
        new Map([['secretary-treasurer', 1]]),
        maxByRole,
      ),
    ).toBe(false);
    expect(
      hasFreeSlot('counselor', new Map([['counselor', 9]]), maxByRole),
    ).toBe(true);
  });

  it.each([
    [{ isSelf: true }, ErrorCode.CLUB_ROLE_SELF_ASSIGNMENT],
    [{ hasGmMembership: false }, ErrorCode.CLUB_ROLE_GM_MEMBERSHIP_REQUIRED],
    [{ holdsRoleInTargetSection: true }, ErrorCode.CLUB_ROLE_ALREADY_HELD],
    [{ consentBlocked: true }, ErrorCode.MR_CONSENT_NOT_VERIFIED],
  ])('blocks all roles with %j', (override, code) => {
    const result = evaluateServiceRoleAllowance({ ...base, ...override });
    expect(result.allowedRoles).toEqual([]);
    expect(result.blockedReason).toBe(code);
  });
});
