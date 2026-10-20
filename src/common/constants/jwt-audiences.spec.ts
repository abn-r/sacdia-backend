import {
  ACCEPTED_BEARER_AUDIENCES,
  ACCESS_JWT_AUDIENCE,
  ACCESS_JWT_ISSUER,
  DEVICE_AUDIENCE,
  QR_MEMBER_AUDIENCE,
  accessJwtClaims,
  deviceJwtClaims,
  isAccessJwtClaims,
  isDeviceJwtClaims,
} from './jwt-audiences';

describe('jwt audiences', () => {
  it('the Passport verifier accepts exactly the access and device audiences (never the QR one)', () => {
    expect(ACCEPTED_BEARER_AUDIENCES).toEqual([
      ACCESS_JWT_AUDIENCE,
      DEVICE_AUDIENCE,
    ]);
    expect(ACCEPTED_BEARER_AUDIENCES).not.toContain(QR_MEMBER_AUDIENCE);
  });

  it('a device claim set is our issuer and EXACTLY the device string', () => {
    expect(deviceJwtClaims()).toEqual({
      iss: ACCESS_JWT_ISSUER,
      aud: 'sacdia:device',
    });
    expect(isDeviceJwtClaims(deviceJwtClaims())).toBe(true);
  });

  it.each([
    ['an audience array', { aud: ['sacdia:device'] }],
    ['both audiences', { aud: ['sacdia:access', 'sacdia:device'] }],
    ['the access audience', { aud: 'sacdia:access' }],
    ['the QR audience', { aud: 'sacdia:qr-member' }],
    ['a wrong issuer', { iss: 'https://evil.example' }],
    ['no audience', { aud: undefined }],
    ['no issuer', { iss: undefined }],
  ])('%s is not a device claim set', (_label, override) => {
    expect(isDeviceJwtClaims({ ...deviceJwtClaims(), ...override })).toBe(
      false,
    );
  });

  it('a device claim set is not an access claim set and the other way round', () => {
    expect(isAccessJwtClaims(deviceJwtClaims())).toBe(false);
    expect(isDeviceJwtClaims(accessJwtClaims())).toBe(false);
  });
});
