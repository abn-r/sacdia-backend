import { lazyModule } from './lazy-module';

describe('lazyModule', () => {
  it('does not call the loader until the first use', () => {
    const load = jest.fn(() => ({ ok: true }));

    lazyModule(load);

    expect(load).not.toHaveBeenCalled();
  });

  it('loads once and caches the value', () => {
    const value = { ok: true };
    const load = jest.fn(() => value);
    const get = lazyModule(load);

    expect(get()).toBe(value);
    expect(get()).toBe(value);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed load so a later call retries', () => {
    const load = jest
      .fn<{ ok: boolean }, []>()
      .mockImplementationOnce(() => {
        throw new Error('cannot load');
      })
      .mockImplementation(() => ({ ok: true }));
    const get = lazyModule(load);

    expect(() => get()).toThrow('cannot load');
    expect(get()).toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
