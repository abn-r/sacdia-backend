import type { PermissionKey } from '../common/authorization/generated/permission-keys';

/**
 * Permission name constants for camporee orders.
 * These match the codes seeded in prisma/seeds/permissions.seed.sql.
 */
export const CAMPOREE_ORDERS_READ =
  'camporee-orders:read' satisfies PermissionKey;
export const CAMPOREE_ORDERS_CATALOG_MANAGE =
  'camporee-orders:catalog-manage' satisfies PermissionKey;
export const CAMPOREE_ORDERS_OFFERING_CONFIGURE =
  'camporee-orders:offering-configure' satisfies PermissionKey;
export const CAMPOREE_ORDERS_CREATE =
  'camporee-orders:create' satisfies PermissionKey;
export const CAMPOREE_ORDERS_UPLOAD_PROOF =
  'camporee-orders:upload-proof' satisfies PermissionKey;
export const CAMPOREE_ORDERS_REVIEW =
  'camporee-orders:review' satisfies PermissionKey;
export const CAMPOREE_ORDERS_AUTHORIZE_WITHOUT_PROOF =
  'camporee-orders:authorize-without-proof' satisfies PermissionKey;
export const CAMPOREE_ORDERS_DELIVER =
  'camporee-orders:deliver' satisfies PermissionKey;
export const CAMPOREE_ORDERS_DISTRIBUTE =
  'camporee-orders:distribute' satisfies PermissionKey;
