import { TENANT_BINDING_ALLOWLIST } from './tenant-binding-allowlist';

/**
 * RATCHET: tenant-binding-allowlist is empty and must stay empty.
 */
const RAISED =
  'No agregues rutas a tenant-binding-allowlist. Declara `bind` en @AuthorizationResource o una policy de recurso.';

describe('tenant-binding-allowlist freeze (ratchet)', () => {
  it('is empty', () => {
    const keys = Object.keys(TENANT_BINDING_ALLOWLIST);
    if (keys.length > 0) throw new Error(`${RAISED} (${keys.join(', ')})`);
    expect(keys).toEqual([]);
  });
});
