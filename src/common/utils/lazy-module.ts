/**
 * Memoizes a synchronous module loader so heavy dependencies are required the
 * first time they are needed instead of at import time.
 *
 * Usage (keep the literal `require` and the `typeof import` cast at the call
 * site so the module keeps its types and bundlers/Jest can still resolve it):
 *
 *   const loadXlsx = lazyModule(() => require('xlsx') as typeof import('xlsx'));
 *
 * Why not `await import()`: with `module: nodenext` it would resolve the ESM
 * entry of dual packages (different from the CJS entry used by static imports)
 * and it needs `--experimental-vm-modules` under Jest.
 *
 * A failed load is not cached, so a later call retries.
 */
export function lazyModule<T>(load: () => T): () => T {
  let loaded = false;
  let value: T;
  return () => {
    if (!loaded) {
      value = load();
      loaded = true;
    }
    return value;
  };
}
