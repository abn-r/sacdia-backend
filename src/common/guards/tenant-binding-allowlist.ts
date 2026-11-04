/**
 * Routes with resource type `global` / `user` / `active_assignment` whose path
 * carries a tenant identifier but that do not declare `bind`. Empty since
 * fase 5: new routes must declare `bind` or a resource policy.
 * tenant-binding-inventory.spec.ts fails on any unbound tenant route, and
 * tenant-binding-allowlist.freeze.spec.ts requires this object to stay empty.
 */

export const TENANT_BINDING_ALLOWLIST: Readonly<Record<string, string>> = {};
