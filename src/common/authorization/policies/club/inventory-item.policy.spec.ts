import { ErrorCode } from '../../../errors/error-codes';
import type { PolicyContext } from '../resource-policy';
import { InstanceScopeValidator } from '../scope/instance-scope';
import { InventoryItemPolicy } from './inventory-item.policy';

const section = { club_section_id: 5, main_club_id: 10, club_type_id: 2 };
const row = { club_section_id: 5, club_sections: section };

describe('InventoryItemPolicy', () => {
  const build = (found: unknown, canManage: boolean) => {
    const prisma = {
      club_inventory: { findUnique: jest.fn().mockResolvedValue(found) },
    } as any;
    const authorizationContext = {
      canManageClub: jest.fn().mockResolvedValue(canManage),
    } as any;
    return new InventoryItemPolicy(
      prisma,
      new InstanceScopeValidator(prisma, authorizationContext),
    );
  };
  const ctx = (): PolicyContext => ({
    userId: 'user-1',
    request: { params: { id: '8' } },
    resolved: {
      authorization: { effective: { scope: { club: null } } },
    } as any,
    requirement: { permissions: ['x:y'], mode: 'all' },
    resource: { type: 'inventory_item' },
  });

  it('handles the inventory_item resource type', () => {
    expect(build(row, true).type).toBe('inventory_item');
  });

  it('throws 404 when the resource does not exist', async () => {
    await expect(build(null, true).resolve(ctx())).rejects.toMatchObject({
      status: 404,
      code: ErrorCode.INVENTORY_NOT_FOUND,
    });
  });

  it('allows when the actor can manage the club', async () => {
    await expect(build(row, true).resolve(ctx())).resolves.toBe(true);
  });

  it('denies with GUARD_CLUB_SCOPE_REQUIRED otherwise', async () => {
    await expect(build(row, false).resolve(ctx())).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
    });
  });
});
