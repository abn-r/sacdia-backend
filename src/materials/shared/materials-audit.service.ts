import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// prettier-ignore
export type MaterialAuditTransaction = Pick<Prisma.TransactionClient, 'materialAuditLog'>;
// prettier-ignore
export type MaterialCategoryAuditAction = 'category.created' | 'category.updated' | 'category.deactivated' | 'category.reactivated' | 'category.deleted';
// prettier-ignore
export type MaterialCategoryAuditField = 'active' | 'has_icon' | 'label' | 'slug' | 'sort_order';
export interface MaterialCategoryAuditState {
  active: boolean;
  has_icon: boolean;
}
export interface MaterialAuditWrite {
  localFieldId: number;
  actorUserId: string;
  correlationId: string;
  entityType: 'category';
  entityId: string;
  action: MaterialCategoryAuditAction;
  changedFields: readonly MaterialCategoryAuditField[];
  before: MaterialCategoryAuditState | null;
  after: MaterialCategoryAuditState | null;
}

export const MATERIAL_AUDIT_SNAPSHOT_MAX_BYTES = 16_384;
// prettier-ignore
const INPUT_KEYS = ['action', 'actorUserId', 'after', 'before', 'changedFields', 'correlationId', 'entityId', 'entityType', 'localFieldId'] as const;
// prettier-ignore
const ACTIONS = new Set<MaterialCategoryAuditAction>(['category.created', 'category.updated', 'category.deactivated', 'category.reactivated', 'category.deleted']);
// prettier-ignore
const FIELDS = new Set<MaterialCategoryAuditField>(['active', 'has_icon', 'label', 'slug', 'sort_order']);
const STATE_KEYS = ['active', 'has_icon'] as const;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Snapshot = {
  value: Prisma.InputJsonValue | Prisma.NullTypes.JsonNull;
  bytes: number;
  active: boolean | null;
};

@Injectable()
export class MaterialsAuditService {
  async record(
    tx: MaterialAuditTransaction,
    unsafe: MaterialAuditWrite,
  ): Promise<void> {
    const entry = this.input(unsafe);
    const changedFields = this.changedFields(entry.changedFields);
    const before = this.snapshot(entry.before, changedFields);
    const after = this.snapshot(entry.after, changedFields);
    this.validateSemantics(
      entry.action,
      changedFields,
      before.active,
      after.active,
    );
    if (before.bytes + after.bytes > MATERIAL_AUDIT_SNAPSHOT_MAX_BYTES)
      this.invalidSnapshot();
    try {
      await tx.materialAuditLog.create({
        data: {
          local_field_id: entry.localFieldId,
          actor_user_id: entry.actorUserId,
          correlation_id: entry.correlationId,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          action: entry.action,
          before_json: before.value,
          after_json: after.value,
        },
        select: { id: true },
      });
    } catch {
      throw new InternalServerErrorException({
        code: 'material_audit_write_failed',
        message: 'The Materials mutation could not be audited.',
      });
    }
  }

  // prettier-ignore
  private input(source: MaterialAuditWrite): MaterialAuditWrite {
    if (Object.getPrototypeOf(source) !== Object.prototype) return this.invalidSnapshot();
    const keys = Reflect.ownKeys(source);
    if (keys.length !== INPUT_KEYS.length || keys.some((key) =>
      typeof key !== 'string' || !INPUT_KEYS.includes(key as (typeof INPUT_KEYS)[number]))) return this.invalidSnapshot();
    const descriptors = Object.getOwnPropertyDescriptors(source);
    if (INPUT_KEYS.some((key) => !descriptors[key]?.enumerable || !('value' in descriptors[key]))) return this.invalidSnapshot();
    const entry = Object.fromEntries(INPUT_KEYS.map((key) => [key, descriptors[key].value])) as unknown as MaterialAuditWrite;
    if (!Number.isSafeInteger(entry.localFieldId) || entry.localFieldId < 1 ||
        !UUID.test(entry.actorUserId) || !UUID.test(entry.correlationId) || !UUID.test(entry.entityId) ||
        entry.entityType !== 'category' || !ACTIONS.has(entry.action)) return this.invalidSnapshot();
    return entry;
  }

  // prettier-ignore
  private changedFields(fields: readonly MaterialCategoryAuditField[]): MaterialCategoryAuditField[] {
    if (!Array.isArray(fields) || Object.getPrototypeOf(fields) !== Array.prototype) return this.invalidSnapshot();
    const keys = Reflect.ownKeys(fields);
    if (keys.length !== fields.length + 1 || keys.some((key, index) =>
      index < fields.length ? key !== String(index) : key !== 'length')) return this.invalidSnapshot();
    const result = Array.from({ length: fields.length }, (_unused, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(fields, String(index));
      if (!descriptor || !('value' in descriptor) || !FIELDS.has(descriptor.value)) return this.invalidSnapshot();
      return descriptor.value;
    });
    if (new Set(result).size !== result.length) return this.invalidSnapshot();
    return result;
  }

  // prettier-ignore
  private snapshot(raw: MaterialCategoryAuditState | null, fields: MaterialCategoryAuditField[]): Snapshot {
    if (raw === null) return { value: Prisma.JsonNull, bytes: 4, active: null };
    if (typeof raw !== 'object' || Object.getPrototypeOf(raw) !== Object.prototype) return this.invalidSnapshot();
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== STATE_KEYS.length || keys.some((key) =>
      typeof key !== 'string' || !STATE_KEYS.includes(key as (typeof STATE_KEYS)[number]))) return this.invalidSnapshot();
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (STATE_KEYS.some((key) => !descriptors[key]?.enumerable || !('value' in descriptors[key]))) return this.invalidSnapshot();
    const active = descriptors.active.value;
    const hasIcon = descriptors.has_icon.value;
    if (typeof active !== 'boolean' || typeof hasIcon !== 'boolean') return this.invalidSnapshot();
    const value: Prisma.InputJsonObject = {
      active, changed_fields: [...fields], has_icon: hasIcon,
    };
    return { value, bytes: Buffer.byteLength(JSON.stringify(value), 'utf8'), active };
  }

  // prettier-ignore
  private validateSemantics(action: MaterialCategoryAuditAction, fields: MaterialCategoryAuditField[], before: boolean | null, after: boolean | null): void {
    if (action === 'category.created' && (before !== null || after === null || fields.length)) return this.invalidSnapshot();
    if (action === 'category.deleted' && (before === null || after !== null || fields.length)) return this.invalidSnapshot();
    if (action === 'category.updated' &&
        (before === null || after === null || !fields.length || fields.includes('active'))) return this.invalidSnapshot();
    if (action === 'category.deactivated' &&
        (before !== true || after !== false || fields.length !== 1 || fields[0] !== 'active')) return this.invalidSnapshot();
    if (action === 'category.reactivated' &&
        (before !== false || after !== true || fields.length !== 1 || fields[0] !== 'active')) return this.invalidSnapshot();
  }

  private invalidSnapshot(): never {
    throw new InternalServerErrorException({
      code: 'material_audit_snapshot_invalid',
      message: 'The Materials audit snapshot is invalid.',
    });
  }
}
