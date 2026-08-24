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

// Increase timeout for database connections
jest.setTimeout(30000);

// Suppress console.log during tests (optional)
// global.console.log = jest.fn();

// Clean up after all tests
afterAll(async () => {
  // Add any global cleanup here
  await new Promise((resolve) => setTimeout(resolve, 500));
});
