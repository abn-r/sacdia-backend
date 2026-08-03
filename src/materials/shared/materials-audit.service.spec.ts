import { Prisma } from '@prisma/client';
import {
  MATERIAL_AUDIT_SNAPSHOT_MAX_BYTES,
  MaterialsAuditService,
  type MaterialAuditTransaction,
  type MaterialAuditWrite,
} from './materials-audit.service';

describe('MaterialsAuditService', () => {
  const create = jest.fn();
  const tx = {
    materialAuditLog: { create },
  } as unknown as MaterialAuditTransaction;
  const service = new MaterialsAuditService();
  const state = () => ({ active: true, has_icon: true });
  const entry = () => ({
    localFieldId: 7,
    actorUserId: '00000000-0000-0000-0000-000000000001',
    correlationId: '00000000-0000-0000-0000-000000000002',
    entityType: 'category',
    entityId: '00000000-0000-0000-0000-000000000003',
    action: 'category.updated',
    changedFields: ['label'] as string[],
    before: state(),
    after: state(),
  });
  const expectInvalid = async (overrides: object) => {
    await expect(
      service.record(tx, {
        ...entry(),
        ...overrides,
      } as unknown as MaterialAuditWrite),
    ).rejects.toMatchObject({
      response: { code: 'material_audit_snapshot_invalid' },
    });
    expect(create).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    jest.resetAllMocks();
    create.mockResolvedValue({ id: 'audit-id' });
  });

  it('writes only the exact category projection and clones it before create', async () => {
    const input = entry();
    const pending = service.record(tx, input as unknown as MaterialAuditWrite);
    input.before.has_icon = false;
    input.changedFields[0] = 'bank_account_clabe';
    await pending;

    const projected = {
      active: true,
      changed_fields: ['label'],
      has_icon: true,
    };
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity_type: 'category',
        action: 'category.updated',
        before_json: projected,
        after_json: projected,
      }),
      select: { id: true },
    });
  });

  it('requires deliberate snapshots and applies exact lifecycle semantics', async () => {
    // @ts-expect-error audit snapshots and changedFields are mandatory
    const compileFailure: MaterialAuditWrite = { localFieldId: 7 };
    expect(compileFailure).toBeDefined();

    await expect(
      service.record(tx, {
        ...entry(),
        action: 'category.created',
        changedFields: [],
        before: null,
      } as unknown as MaterialAuditWrite),
    ).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ before_json: Prisma.JsonNull }),
      }),
    );

    const omitted = entry() as Partial<ReturnType<typeof entry>>;
    delete omitted.before;
    await expect(
      service.record(tx, omitted as unknown as MaterialAuditWrite),
    ).rejects.toMatchObject({
      response: { code: 'material_audit_snapshot_invalid' },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  // prettier-ignore
  it.each(['bank_account_clabe', 'account_holder', 'pickup_address', 'paternal_last_name', 'maternal_last_name', 'file_name'])(
    'rejects non-semantic key %s before create', async (key) => {
    await expectInvalid({ before: { ...state(), [key]: 'sensitive' } });
  });

  // prettier-ignore
  it.each([
    ['value hidden under benign key', { ...state(), has_icon: '4111111111111111' }, ['label']],
    ['nested payload', { ...state(), active: { token: 'hidden' } }, ['label']],
    ['protected changed field', state(), ['label', 'file_name']],
    ['changed field accessor', state(), Object.defineProperty([], '0', { get: () => 'label' })],
    ['oversize value', { ...state(), has_icon: 'x'.repeat(MATERIAL_AUDIT_SNAPSHOT_MAX_BYTES) }, ['label']],
    ['custom prototype', Object.create(state()), ['label']],
    ['snapshot accessor', Object.defineProperty(state(), 'active', { get: () => true }), ['label']],
  ])('rejects %s before create', async (_name, before, changedFields) => {
    await expectInvalid({ before, changedFields });
  });

  it('rejects an invalid category transition before create', async () => {
    await expectInvalid({
      action: 'category.deactivated',
      changedFields: ['active'],
      before: { ...state(), active: false },
      after: { ...state(), active: false },
    });
  });

  // prettier-ignore
  it.each([
    ['updated active transition hidden as label', {
      changedFields: ['label'], after: { ...state(), active: false },
    }],
    ['updated has_icon transition hidden as label', {
      changedFields: ['label'], after: { ...state(), has_icon: false },
    }],
    ['updated has_icon declared without a delta', { changedFields: ['has_icon'] }],
    ['updated immutable slug', { changedFields: ['slug'] }],
    ['deactivation has_icon transition', {
      action: 'category.deactivated', changedFields: ['active'],
      before: state(), after: { active: false, has_icon: false },
    }],
    ['reactivation has_icon transition', {
      action: 'category.reactivated', changedFields: ['active'],
      before: { active: false, has_icon: true }, after: { active: true, has_icon: false },
    }],
  ])('rejects %s before create', async (_name, overrides) => {
    await expectInvalid(overrides);
  });

  it('never swallows a database failure', async () => {
    create.mockRejectedValue(new Error('database detail'));
    await expect(
      service.record(tx, entry() as unknown as MaterialAuditWrite),
    ).rejects.toMatchObject({
      status: 500,
      response: { code: 'material_audit_write_failed' },
    });
  });
});
