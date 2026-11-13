import {
  getSensitiveUserSubresourcePolicy,
  USERS_LEGACY_OR_SUNSET_DATE,
} from './sensitive-user-subresource-policy';

describe('sensitive user subresource policy (guardianship family)', () => {
  it('maps the family to guardianship:read|update with the users:* fallback', () => {
    expect(getSensitiveUserSubresourcePolicy('guardianship', 'read')).toEqual({
      finePermission: 'guardianship:read',
      legacyFallbackPermission: 'users:read_detail',
    });
    expect(getSensitiveUserSubresourcePolicy('guardianship', 'update')).toEqual(
      {
        finePermission: 'guardianship:update',
        legacyFallbackPermission: 'users:update_profile',
      },
    );
  });

  it('keeps the users:* fallback until 2027-03-31', () => {
    expect(USERS_LEGACY_OR_SUNSET_DATE).toBe('2027-03-31');
  });
});
