import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test } from '@nestjs/testing';
import { MfaFailureCounter } from './mfa-failure-counter';
import { CommonModule } from '../common.module';

// Resolves MfaFailureCounter through Nest's injector exactly as CommonModule
// registers it. Constructing it with `new` (the other specs) cannot catch a
// provider that fails to resolve at boot.
describe('MfaFailureCounter dependency injection', () => {
  it('resolves with only CACHE_MANAGER available', async () => {
    const registered = Reflect.getMetadata(
      'providers',
      CommonModule,
    ) as unknown[];
    const provider = registered.find(
      (p) =>
        p === MfaFailureCounter ||
        (typeof p === 'object' &&
          p !== null &&
          (p as { provide?: unknown }).provide === MfaFailureCounter),
    );
    expect(provider).toBeDefined();

    const moduleRef = await Test.createTestingModule({
      providers: [
        provider as never,
        { provide: CACHE_MANAGER, useValue: { stores: [] } },
      ],
    }).compile();

    const counter = moduleRef.get(MfaFailureCounter);
    expect(counter).toBeInstanceOf(MfaFailureCounter);
    expect(
      (
        counter as never as {
          keys: (s: string, i: string) => { failures: string };
        }
      ).keys('id', 'abc').failures,
    ).toBe('mfa:fail:id:abc');
  });
});
