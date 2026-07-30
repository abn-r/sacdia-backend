const mockGetApps = jest.fn();
const mockInitializeApp = jest.fn();
const mockCert = jest.fn();
const mockGetMessaging = jest.fn();

jest.mock('firebase-admin/app', () => ({
  getApps: (...args: unknown[]) => mockGetApps(...args),
  initializeApp: (...args: unknown[]) => mockInitializeApp(...args),
  cert: (...args: unknown[]) => mockCert(...args),
}));

jest.mock('firebase-admin/messaging', () => ({
  getMessaging: (...args: unknown[]) => mockGetMessaging(...args),
}));

import { FirebaseAdminModule, firebaseAdmin } from './firebase-admin.module';

describe('FirebaseAdminModule modular API contract', () => {
  const firebaseEnvKeys = [
    'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
  ] as const;
  const originalEnv = Object.fromEntries(
    firebaseEnvKeys.map((key) => [key, process.env[key]]),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetApps.mockReturnValue([]);
    mockCert.mockReturnValue({ kind: 'credential' });
    mockInitializeApp.mockReturnValue({ name: '[DEFAULT]' });

    for (const key of firebaseEnvKeys) {
      delete process.env[key];
    }

    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    for (const key of firebaseEnvKeys) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('uses getApps to preserve idempotent initialization', () => {
    mockGetApps.mockReturnValue([{ name: '[DEFAULT]' }]);

    new FirebaseAdminModule();

    expect(mockGetApps).toHaveBeenCalledTimes(1);
    expect(mockCert).not.toHaveBeenCalled();
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });

  it('initializes with cert from normalized legacy credentials', () => {
    process.env.FIREBASE_PROJECT_ID = ' sacdia-test ';
    process.env.FIREBASE_PRIVATE_KEY = 'line-1\\nline-2';
    process.env.FIREBASE_CLIENT_EMAIL = ' firebase@example.com ';

    new FirebaseAdminModule();

    expect(mockCert).toHaveBeenCalledWith({
      projectId: 'sacdia-test',
      privateKey: 'line-1\nline-2',
      clientEmail: 'firebase@example.com',
    });
    expect(mockInitializeApp).toHaveBeenCalledWith({
      credential: { kind: 'credential' },
    });
  });

  it('exports modular app and messaging accessors for consumers', () => {
    expect(firebaseAdmin).toEqual({
      getApps: expect.any(Function),
      getMessaging: expect.any(Function),
    });

    firebaseAdmin.getApps();
    firebaseAdmin.getMessaging();

    expect(mockGetApps).toHaveBeenCalledTimes(1);
    expect(mockGetMessaging).toHaveBeenCalledTimes(1);
  });
});
