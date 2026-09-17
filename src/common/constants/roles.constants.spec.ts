import { CLUB_ROLE, GLOBAL_ROLE } from './roles.constants';

describe('roles.constants', () => {
  it('exports territorial, coordinator family and secretary-treasurer', () => {
    expect(GLOBAL_ROLE.DIRECTOR_LF).toBe('director-lf');
    expect(GLOBAL_ROLE.ASSISTANT_LF).toBe('assistant-lf');
    expect(GLOBAL_ROLE.DIRECTOR_UNION).toBe('director-union');
    expect(GLOBAL_ROLE.ASSISTANT_UNION).toBe('assistant-union');
    expect(GLOBAL_ROLE.DIRECTOR_DIA).toBe('director-dia');
    expect(GLOBAL_ROLE.ASSISTANT_DIA).toBe('assistant-dia');
    expect(GLOBAL_ROLE.ZONE_COORDINATOR).toBe('zone-coordinator');
    expect(GLOBAL_ROLE.GENERAL_COORDINATOR).toBe('general-coordinator');
    expect(CLUB_ROLE.SECRETARY_TREASURER).toBe('secretary-treasurer');
  });
});
