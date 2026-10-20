import type { Prisma } from '@prisma/client';

/**
 * Port between the 3a guardianship code and the linked devices of 3b.
 *
 * Several 3a flows must cut the paired phones of a child in the SAME
 * transaction as the change that makes them invalid (a teen login is enabled, a
 * guardian leaves, a teen links a guardian, the child is frozen). 3a does not
 * know about devices yet, so it calls this port; the default provider is a
 * no-op, and 3b binds the real service to the token without touching the 3a
 * callers.
 *
 * Contract for implementations: use the transaction client they are handed (the
 * revoke must commit or roll back with the caller), and never throw for "no
 * devices". Cache invalidation (the dependent's epoch bump) stays with the
 * caller, after the commit.
 */
export const LINKED_DEVICE_REVOKER = Symbol('LINKED_DEVICE_REVOKER');

/**
 * Why a device was revoked: the vocabulary of `linked_devices.revoked_reason`
 * (a DB CHECK, mirrored by the migration guard spec). "The last guardian left"
 * and a custody transfer are `guardianship_revoked`: the pairing guardianship
 * is what went away.
 */
export type LinkedDeviceRevokeReason =
  | 'guardian'
  | 'guardianship_revoked'
  | 'guardian_account_closed'
  | 'teen_login_enabled'
  | 'majority'
  | 'dependent_frozen'
  | 'device_logout'
  | 'session_revoked'
  | 'admin'
  | 'expired';

export interface LinkedDeviceRevoker {
  /** Revokes EVERY active device of the dependent. Returns how many. */
  revokeAllForDependent(
    tx: Prisma.TransactionClient,
    dependentUserId: string,
    reason: LinkedDeviceRevokeReason,
  ): Promise<number>;

  /** Revokes the devices that were paired through this guardianship. Returns how many. */
  revokeByGuardianship(
    tx: Prisma.TransactionClient,
    guardianshipId: string,
    reason: LinkedDeviceRevokeReason,
  ): Promise<number>;
}

/** Default binding: there are no devices until 3b. */
export const NOOP_LINKED_DEVICE_REVOKER: LinkedDeviceRevoker = {
  revokeAllForDependent: () => Promise.resolve(0),
  revokeByGuardianship: () => Promise.resolve(0),
};
