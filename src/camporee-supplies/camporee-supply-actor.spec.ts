import { ErrorCode } from '../common/errors/error-codes';
import type { ActorTerritoryScope } from '../common/authorization/actor-territory-scope';
import {
  SUPPLY_ISSUER_CLUB_ROLES,
  assertCanPlanSupplies,
  canBypassSupplyFreeze,
  canConfigureSupplyOrganizer,
  canDeliverSupplies,
  canReviewSupplyPayment,
  type CamporeeSupplyActor,
} from './camporee-supply-actor';

const LF_10 = 10;

function baseActor(
  overrides: Partial<CamporeeSupplyActor> & {
    territory: ActorTerritoryScope;
  },
): CamporeeSupplyActor {
  return {
    userId: 'user-1',
    sectionIds: [],
    globalAccess: false,
    canReview: false,
    globalRoles: [],
    ...overrides,
  };
}

function clubActor(role: string): CamporeeSupplyActor {
  return baseActor({
    localFieldId: LF_10,
    territory: { level: 'open' },
    activeSection: {
      club_section_id: 11,
      club_id: 5,
      club_name: 'Club Orión',
      club_type_id: 1,
      role_name: role,
      local_field_id: LF_10,
    },
  });
}

describe('camporee supply actor', () => {
  it('allows director, secretary and secretary-treasurer to plan', () => {
    expect(SUPPLY_ISSUER_CLUB_ROLES.has('director')).toBe(true);
    expect(() => assertCanPlanSupplies(clubActor('director'))).not.toThrow();
    expect(() => assertCanPlanSupplies(clubActor('secretary'))).not.toThrow();
    expect(() =>
      assertCanPlanSupplies(clubActor('secretary-treasurer')),
    ).not.toThrow();
  });

  it('rejects deputy-director, treasurer and counselor', () => {
    for (const role of ['deputy-director', 'treasurer', 'counselor']) {
      expect(() => assertCanPlanSupplies(clubActor(role))).toThrow(
        expect.objectContaining({
          code: ErrorCode.CAMPOREE_SUPPLIES_FORBIDDEN,
        }),
      );
    }
  });

  it('lets LF caja review and deliver in its field', () => {
    const actor = baseActor({
      localFieldId: LF_10,
      globalRoles: ['director-lf'],
      canReview: true,
      territory: {
        level: 'local_field',
        localFieldId: LF_10,
        unionId: 2,
        divisionId: 1,
      },
    });
    expect(canReviewSupplyPayment(actor, LF_10)).toBe(true);
    expect(canDeliverSupplies(actor, LF_10)).toBe(true);
    expect(canReviewSupplyPayment(actor, 99)).toBe(false);
    expect(canBypassSupplyFreeze(actor)).toBe(true);
  });

  it('lets the local organizer configure a local camporee', () => {
    const actor = baseActor({
      localFieldId: LF_10,
      globalRoles: ['director-lf'],
      territory: {
        level: 'local_field',
        localFieldId: LF_10,
        unionId: 2,
        divisionId: 1,
      },
    });
    expect(
      canConfigureSupplyOrganizer(actor, {
        type: 'local',
        localFieldId: LF_10,
      }),
    ).toBe(true);
    expect(
      canConfigureSupplyOrganizer(actor, {
        type: 'union',
        unionId: 2,
      }),
    ).toBe(false);
  });

  it('does not let a club director bypass freeze', () => {
    expect(canBypassSupplyFreeze(clubActor('director'))).toBe(false);
  });
});
