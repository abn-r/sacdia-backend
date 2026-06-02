#!/usr/bin/env node

/**
 * Backwards-compatible wrapper for the old load-test entrypoint.
 * Prefer `pnpm run benchmark:*` for reproducible benchmark profiles.
 */

const { main } = require('./benchmark-api');

const legacyDefaults = [
  '--profile',
  'smoke',
  '--connections',
  '10',
  '--duration',
  '10',
];

main([...legacyDefaults, ...process.argv.slice(2)]).catch((error) => {
  console.error(`\n❌ Load test failed: ${error.message}`);
  process.exit(1);
});
