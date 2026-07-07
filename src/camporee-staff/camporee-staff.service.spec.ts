import { ErrorCode } from '../common/errors/error-codes';
import { CamporeeStaffService } from './camporee-staff.service';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';

const user = {
  user_id: USER_ID,
  email: 'staff@example.com',
  name: 'Ada',
  paternal_last_name: 'Lovelace',
  maternal_last_name: null,
  user_image: null,
  active: true,
  access_app: true,
  access_panel: true,
  unions: { union_id: 2, name: 'Unión' },
  local_fields: { local_field_id: 5, union_id: 2, name: 'Campo' },
};

const staffRow = {
  camporee_staff_member_id: STAFF_ID,
  local_camporee_id: 10,
  union_camporee_id: null,
  user_id: USER_ID,
  category: 'support',
  role_label: 'Logística',
  notes: null,
  status: 'active',
  active: true,
  user,
};

const makePrisma = () => ({
  local_camporees: {
    findUnique: jest.fn().mockResolvedValue({
      local_camporee_id: 10,
      local_field_id: 5,
    }),
  },
  union_camporees: {
    findUnique: jest.fn().mockResolvedValue({
      union_camporee_id: 20,
      union_id: 2,
    }),
  },
  users: {
    findFirst: jest.fn().mockResolvedValue({ user_id: USER_ID }),
    findMany: jest.fn().mockResolvedValue([user]),
  },
  camporee_staff_members: {
    findMany: jest.fn().mockResolvedValue([staffRow]),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(staffRow),
    create: jest.fn().mockResolvedValue(staffRow),
    update: jest.fn().mockResolvedValue({ ...staffRow, active: false }),
  },
});

const makeAuth = () => ({
  resolveUserAuthorization: jest.fn().mockResolvedValue({
    authorization: {
      effective: { permissions: ['camporee_events:update'] },
    },
  }),
  canAccessHierarchyScope: jest.fn().mockReturnValue(true),
});

describe('CamporeeStaffService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let auth: ReturnType<typeof makeAuth>;
  let service: CamporeeStaffService;

  beforeEach(() => {
    prisma = makePrisma();
    auth = makeAuth();
    service = new CamporeeStaffService(prisma as any, auth as any);
  });

  it('lists local camporee staff', async () => {
    const result = await service.listStaff({ type: 'local', camporeeId: 10 });

    expect(prisma.local_camporees.findUnique).toHaveBeenCalledWith({
      where: { local_camporee_id: 10 },
      select: { local_camporee_id: true, local_field_id: true },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      camporee_staff_member_id: STAFF_ID,
      category: 'support',
      user: { full_name: 'Ada Lovelace' },
    });
  });

  it('lists union camporee staff candidates from broad active users in scope', async () => {
    const result = await service.listStaffCandidates({
      type: 'union',
      camporeeId: 20,
    });

    expect(prisma.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ active: true }),
      }),
    );
    expect(result[0]).toMatchObject({
      user_id: USER_ID,
      already_staff_member_id: STAFF_ID,
    });
  });

  it('adds a staff member from an in-scope active user', async () => {
    prisma.camporee_staff_members.findMany.mockResolvedValueOnce([]);

    const result = await service.addStaffMember(
      { type: 'local', camporeeId: 10 },
      { user_id: USER_ID, category: 'kitchen', role_label: 'Cocina' },
      ACTOR_ID,
    );

    expect(prisma.camporee_staff_members.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          local_camporee_id: 10,
          user_id: USER_ID,
          category: 'kitchen',
          created_by: ACTOR_ID,
        }),
      }),
    );
    expect(result.camporee_staff_member_id).toBe(STAFF_ID);
  });

  it('rejects duplicate active staff member in the same camporee', async () => {
    prisma.camporee_staff_members.findFirst.mockResolvedValueOnce(staffRow);

    await expect(
      service.addStaffMember(
        { type: 'local', camporeeId: 10 },
        { user_id: USER_ID, category: 'support' },
        ACTOR_ID,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_STAFF_DUPLICATE });
  });

  it('deactivates a staff member after scope authorization', async () => {
    const result = await service.deactivateStaffMember(STAFF_ID, ACTOR_ID);

    expect(auth.canAccessHierarchyScope).toHaveBeenCalled();
    expect(prisma.camporee_staff_members.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { camporee_staff_member_id: STAFF_ID },
        data: expect.objectContaining({ active: false, status: 'inactive' }),
      }),
    );
    expect(result.active).toBe(false);
  });
});
