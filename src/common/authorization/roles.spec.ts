import { CLUB_ROLE_NAMES, GLOBAL_ROLE_NAMES } from './generated/role-names';
import { ClubRole, GlobalRole } from './roles';

describe('role constants', () => {
  it('GlobalRole covers every generated global name exactly once', () => {
    expect(Object.values(GlobalRole).sort()).toEqual([...GLOBAL_ROLE_NAMES]);
  });

  it('ClubRole covers every generated club name exactly once', () => {
    expect(Object.values(ClubRole).sort()).toEqual([...CLUB_ROLE_NAMES]);
  });
});
