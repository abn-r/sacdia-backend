// Stub for p-limit's #async_hooks subpath import in Jest (CommonJS/ts-jest context).
// p-limit uses AsyncResource.bind for concurrency tracking; in tests we just pass-through.
export const AsyncResource = {
  bind(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown {
    return fn;
  },
};

export class AsyncLocalStorage<T = unknown> {
  getStore(): T | undefined {
    return undefined;
  }

  run<R>(_store: T, callback: () => R): R {
    return callback();
  }
}
