import { GlobalPolicy } from './global.policy';

describe('GlobalPolicy', () => {
  it('handles the global resource type and allows', async () => {
    const policy = new GlobalPolicy();
    expect(policy.type).toBe('global');
    await expect(policy.resolve()).resolves.toBe(true);
  });
});
