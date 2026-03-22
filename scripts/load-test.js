#!/usr/bin/env node

/**
 * Load Testing Script for SACDIA API
 * 
 * Uses autocannon to benchmark API endpoints and measure performance.
 * 
 * Usage:
 *   npm run load-test                          # Test default endpoint
 *   node scripts/load-test.js /api/users       # Test specific endpoint
 *   URL=http://example.com node scripts/load-test.js  # Custom base URL
 */

const autocannon = require('autocannon');

// Configuration
const baseUrl = process.env.URL || 'http://localhost:3000';
const endpoint = process.argv[2] || '/api/health';
const fullUrl = `${baseUrl}${endpoint}`;

const config = {
  url: fullUrl,
  connections: 10,        // Concurrent connections
  pipelining: 1,          // Requests per connection
  duration: 10,           // Test duration in seconds
  headers: {
    'Content-Type': 'application/json',
  },
};

console.log('🚀 Starting load test...\n');
console.log(`📍 Target: ${fullUrl}`);
console.log(`⏱️  Duration: ${config.duration} seconds`);
console.log(`🔗 Connections: ${config.connections}\n`);
console.log('─'.repeat(80));

// Run the test
autocannon(config, (err, result) => {
  if (err) {
    console.error('❌ Error running load test:', err);
    process.exit(1);
  }

  console.log('\n' + '─'.repeat(80));
  console.log('✅ Load Test Complete\n');

  // Display results
  const stats = {
    'Requests': result.requests.total,
    'Duration': `${result.duration}s`,
    'Throughput': `${(result.throughput / 1024 / 1024).toFixed(2)} MB/s`,
    'Req/sec (avg)': result.requests.average.toFixed(2),
    'Req/sec (max)': result.requests.max,
    'Latency (p50)': `${result.latency.p50}ms`,
    'Latency (p99)': `${result.latency.p99}ms`,
    'Latency (max)': `${result.latency.max}ms`,
    'Errors': result.errors,
    'Timeouts': result.timeouts,
  };

  console.log('📊 Performance Metrics:\n');
  Object.entries(stats).forEach(([key, value]) => {
    console.log(`   ${key.padEnd(20)}: ${value}`);
  });

  console.log('\n' + '─'.repeat(80));

  // Performance assessment
  const avgReqPerSec = result.requests.average;
  const p99Latency = result.latency.p99;
  
  console.log('\n💡 Performance Assessment:\n');
  
  if (avgReqPerSec > 1000) {
    console.log('   🟢 Excellent throughput (>1000 req/s)');
  } else if (avgReqPerSec > 500) {
    console.log('   🟡 Good throughput (500-1000 req/s)');
  } else if (avgReqPerSec > 100) {
    console.log('   🟠 Moderate throughput (100-500 req/s)');
  } else {
    console.log('   🔴 Low throughput (<100 req/s) - consider optimization');
  }

  if (p99Latency < 100) {
    console.log('   🟢 Excellent latency (<100ms at p99)');
  } else if (p99Latency < 500) {
    console.log('   🟡 Good latency (100-500ms at p99)');
  } else if (p99Latency < 1000) {
    console.log('   🟠 Moderate latency (500-1000ms at p99)');
  } else {
    console.log('   🔴 High latency (>1000ms at p99) - optimization needed');
  }

  if (result.errors > 0 || result.timeouts > 0) {
    console.log('   ⚠️  Errors or timeouts detected - investigate failures');
  }

  console.log('');
  process.exit(0);
});

// Handle interruption
process.on('SIGINT', () => {
  console.log('\n\n🛑 Test interrupted by user');
  process.exit(0);
});
