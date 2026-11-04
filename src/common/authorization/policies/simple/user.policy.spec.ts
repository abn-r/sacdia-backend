import { UserPolicy } from './user.policy';

describe('UserPolicy', () => {
  it('handles the user resource type and allows', async () => {
    const policy = new UserPolicy();
    expect(policy.type).toBe('user');
    await expect(policy.resolve()).resolves.toBe(true);
  });
});
