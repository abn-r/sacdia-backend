import { DashboardController } from './dashboard.controller';
import type { DashboardService } from './dashboard.service';
import {
  AGE_UNKNOWN_SCOPES,
  GUARDIAN_PENDING_SCOPES,
  TEEN_PENDING_SCOPES,
  TEEN_SCOPES,
  type AuthPrincipal,
} from '../auth/acting-for/auth-principal';

const base: AuthPrincipal = {
  sub: 'u1',
  userId: 'u1',
  user_id: 'u1',
  email: null,
  mfa_pending: false,
  sid: 'sid-1',
  kind: 'user',
  actor_sub: 'u1',
  acting_for: false,
  scopes: null,
};

describe('DashboardController (club data by principal, FP3-03/FP3-07)', () => {
  const getSummary = jest.fn();
  const controller = new DashboardController({
    getSummary,
  } as unknown as DashboardService);

  beforeEach(() => {
    getSummary.mockReset().mockResolvedValue({});
  });

  it.each<[string, AuthPrincipal, boolean]>([
    [
      'a teen with no verified guardian (pending) gets NO club data',
      {
        ...base,
        kind: 'supervised_user',
        scopes: TEEN_PENDING_SCOPES,
        supervision: 'pending_guardian',
      },
      false,
    ],
    [
      'an unknown-age account gets NO club data',
      { ...base, kind: 'age_unknown_user', scopes: AGE_UNKNOWN_SCOPES },
      false,
    ],
    [
      'a teen with a verified guardian gets the club data',
      {
        ...base,
        kind: 'supervised_user',
        scopes: TEEN_SCOPES,
        supervision: 'active',
      },
      true,
    ],
    ['an adult gets the club data', base, true],
    [
      'a guardian acting for a dependent keeps the Phase 2 behavior',
      {
        ...base,
        sub: 'dep-1',
        userId: 'dep-1',
        user_id: 'dep-1',
        kind: 'guardian_acting',
        acting_for: true,
        scopes: GUARDIAN_PENDING_SCOPES,
        consent_status: 'pending',
      },
      true,
    ],
  ])('%s', async (_label, principal, includeClubData) => {
    await controller.getSummary({ user: principal });
    expect(getSummary).toHaveBeenCalledWith(principal.sub, {
      includeClubData,
    });
  });

  it('a supervised teen with NO supervision status is treated as pending (fail closed)', async () => {
    await controller.getSummary({
      user: { ...base, kind: 'supervised_user', scopes: TEEN_PENDING_SCOPES },
    });
    expect(getSummary).toHaveBeenCalledWith('u1', { includeClubData: false });
  });
});
