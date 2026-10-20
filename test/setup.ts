// E2E Test Setup
// This file runs before all E2E tests

process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32
    ? process.env.BETTER_AUTH_SECRET
    : 'test-better-auth-secret-32chars!!';
process.env.QR_JWT_SECRET =
  process.env.QR_JWT_SECRET &&
  process.env.QR_JWT_SECRET.length >= 32 &&
  process.env.QR_JWT_SECRET !== process.env.BETTER_AUTH_SECRET
    ? process.env.QR_JWT_SECRET
    : 'test-qr-jwt-secret-32-chars-xxxx';

// Since family profiles 3a every authenticated request resolves the principal
// kind (SupervisedPrincipalResolver reads the user's birthday). The e2e suites
// that boot the real AppModule on a dummy database and spy on a few models
// would answer 503 AUTH_REVOCATION_CHECK_UNAVAILABLE, so by default the
// resolver is replaced by one that answers "adult, session alive" (what these
// suites assumed before). A suite that exercises the real resolver opts in with
// `process.env.E2E_REAL_SUPERVISED_RESOLVER = 'true'` at the very top of the
// file, before importing the app module.
jest.mock('../src/auth/supervised/supervised-principal.resolver', () => {
  const actual = jest.requireActual(
    '../src/auth/supervised/supervised-principal.resolver',
  );
  if (process.env.E2E_REAL_SUPERVISED_RESOLVER === 'true') {
    return actual;
  }
  class AdultOnlySupervisedPrincipalResolver {
    resolveForRequest() {
      return Promise.resolve({ state: 'adult' });
    }
    resolve() {
      return Promise.resolve({ state: 'adult' });
    }
    isSessionActive() {
      return Promise.resolve(true);
    }
  }
  return {
    ...actual,
    SupervisedPrincipalResolver: AdultOnlySupervisedPrincipalResolver,
  };
});

// Increase timeout for database connections
jest.setTimeout(30000);

// Suppress console.log during tests (optional)
// global.console.log = jest.fn();

// Clean up after all tests
afterAll(async () => {
  // Add any global cleanup here
  await new Promise((resolve) => setTimeout(resolve, 500));
});
