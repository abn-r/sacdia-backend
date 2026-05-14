/**
 * Permission name constants for the materials module.
 * These match the codes seeded in the RBAC migrations.
 * NOTE: The string values (e.g. 'materiales:read') are DB-seeded RBAC codes
 * and must NOT change — only the TypeScript constant names are renamed.
 */
export const MATERIALS_READ = 'materiales:read';
export const MATERIALS_CREATE = 'materiales:create';
export const MATERIALS_APPROVE = 'materiales:approve';
export const MATERIALS_UPLOAD_RECEIPT = 'materiales:upload-receipt';
export const MATERIALS_VALIDATE_RECEIPT = 'materiales:validate-receipt';
export const MATERIALS_DELIVER = 'materiales:deliver';
export const MATERIALS_MANAGE_INVENTORY = 'materiales:manage-inventory';
export const MATERIALS_CONFIGURE = 'materiales:configure';
