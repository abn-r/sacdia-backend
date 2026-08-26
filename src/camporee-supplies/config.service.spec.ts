import { ErrorCode } from '../common/errors/error-codes';
import type { ActorTerritoryScope } from '../common/authorization/actor-territory-scope';
import type { CamporeeSupplyActor } from './camporee-supply-actor';
import { CamporeeSupplyConfigService } from './config.service';

const LF_10 = 10;
const LOCAL_CAMPOREE_ID = 21;
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function lfActor(): CamporeeSupplyActor {
  return {
    userId: 'lf-1',
    sectionIds: [],
    globalAccess: false,
    canReview: true,
    localFieldId: LF_10,
    globalRoles: ['director-lf'],
    territory: {
      level: 'local_field',
      localFieldId: LF_10,
      unionId: 2,
      divisionId: 1,
    } satisfies ActorTerritoryScope,
  };
}

function localCamporee() {
  return {
    local_camporee_id: LOCAL_CAMPOREE_ID,
    name: 'Camporí',
    timezone: 'America/Mexico_City',
    supply_edit_cutoff_local_time: '21:00',
    local_field_id: LF_10,
    start_date: new Date('2026-08-28T00:00:00.000Z'),
    end_date: new Date('2026-08-30T00:00:00.000Z'),
  };
}

describe('CamporeeSupplyConfigService', () => {
  it('blocks unit price changes after a plan is SUBMITTED', async () => {
    const prisma = {
      local_camporees: {
        findUnique: jest.fn().mockResolvedValue(localCamporee()),
      },
      camporee_supply_products: {
        findFirst: jest.fn().mockResolvedValue({
          camporee_supply_product_id: PRODUCT_ID,
          unit_cost_centavos: 1000,
        }),
        update: jest.fn(),
      },
      camporee_supply_plans: {
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new CamporeeSupplyConfigService(prisma as never);

    await expect(
      service.updateProduct(
        LOCAL_CAMPOREE_ID,
        'local',
        PRODUCT_ID,
        { unit_cost_centavos: 1500 },
        lfActor(),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CAMPOREE_SUPPLIES_PRICE_LOCKED,
    });
    expect(prisma.camporee_supply_products.update).not.toHaveBeenCalled();
  });

  it('allows price changes while every plan is still DRAFT', async () => {
    const prisma = {
      local_camporees: {
        findUnique: jest.fn().mockResolvedValue(localCamporee()),
      },
      camporee_supply_products: {
        findFirst: jest.fn().mockResolvedValue({
          camporee_supply_product_id: PRODUCT_ID,
          unit_cost_centavos: 1000,
        }),
        update: jest.fn().mockResolvedValue({
          camporee_supply_product_id: PRODUCT_ID,
          name: 'Agua',
          uom: 'BAG',
          unit_cost_centavos: 1500,
          active: true,
        }),
      },
      camporee_supply_plans: {
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new CamporeeSupplyConfigService(prisma as never);

    const result = await service.updateProduct(
      LOCAL_CAMPOREE_ID,
      'local',
      PRODUCT_ID,
      { unit_cost_centavos: 1500 },
      lfActor(),
    );
    expect(result.unit_cost_centavos).toBe(1500);
  });
});
