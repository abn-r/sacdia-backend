import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators/authorization-resource.decorator';
import { InsurancePurchasesController } from './insurance-purchases.controller';

describe('InsurancePurchasesController', () => {
  const controller = new InsurancePurchasesController({} as any, {} as any);

  it('declares a valid authorization resource for private purchase proof reads', () => {
    expect(
      Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, controller.getProof),
    ).toEqual({ type: 'active_assignment' });
  });

  it('declares a valid authorization resource for purchase reads', () => {
    expect(
      Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, controller.get),
    ).toEqual({ type: 'active_assignment' });
  });

  it('does not treat pending club assignments as section scope', () => {
    const actor = (controller as any).resolveActor(
      {
        user: { sub: 'user-1' },
        authorizationProfile: {
          authorization: {
            grants: {
              global_roles: [],
              club_assignments: [
                {
                  assignment_id: 'pending-1',
                  status: 'pending',
                  section: { club_section_id: 9 },
                  scope: { local_field: { id: 7 } },
                },
              ],
            },
            effective: { scope: { global: {} } },
          },
        },
      },
      9,
    );

    expect(actor.sectionIds).toEqual([]);
    expect(actor.localFieldId).toBeUndefined();
  });
});
