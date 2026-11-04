import { ActiveAssignmentPolicy } from './active-assignment.policy';

describe('ActiveAssignmentPolicy', () => {
  it('handles the active_assignment resource type and allows', async () => {
    const policy = new ActiveAssignmentPolicy();
    expect(policy.type).toBe('active_assignment');
    await expect(policy.resolve()).resolves.toBe(true);
  });
});
