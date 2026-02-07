import { createClient } from 'redis';
import * as dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

async function testRedisConnection() {
  console.log('🔍 Testing Upstash Redis connection...\n');
  
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.error('❌ REDIS_URL not found in .env file');
    process.exit(1);
  }
  
  console.log(`📡 Connecting to: ${redisUrl.replace(/:[^:]*@/, ':****@')}\n`);
  
  const client = createClient({
    url: redisUrl,
    socket: {
      tls: true,
      rejectUnauthorized: true,
    },
  });

  client.on('error', (err) => {
    console.error('❌ Redis Client Error:', err);
  });

  try {
    // Conectar
    await client.connect();
    console.log('✅ Connected to Redis successfully!\n');

    // Test 1: PING
    console.log('Test 1: PING command');
    const pong = await client.ping();
    console.log(`  Response: ${pong}\n`);

    // Test 2: SET
    console.log('Test 2: SET command');
    await client.set('test:connection', 'Hello from NestJS!', {
      EX: 60, // Expira en 60 segundos
    });
    console.log('  ✅ Key "test:connection" set successfully\n');

    // Test 3: GET
    console.log('Test 3: GET command');
    const value = await client.get('test:connection');
    console.log(`  Value: "${value}"\n`);

    // Test 4: TTL
    console.log('Test 4: TTL command');
    const ttl = await client.ttl('test:connection');
    console.log(`  TTL: ${ttl} seconds\n`);

    // Test 5: DELETE
    console.log('Test 5: DEL command');
    await client.del('test:connection');
    console.log('  ✅ Key deleted successfully\n');

    // Info del servidor
    console.log('📊 Redis Server Info:');
    const info = await client.info('server');
    const lines = info.split('\r\n');
    const redisVersion = lines.find((line) => line.startsWith('redis_version:'));
    const uptimeInDays = lines.find((line) => line.startsWith('uptime_in_days:'));
    
    if (redisVersion) console.log(`  ${redisVersion}`);
    if (uptimeInDays) console.log(`  ${uptimeInDays}`);

    console.log('\n🎉 All tests passed! Redis is ready to use.');
    
  } catch (error) {
    console.error('\n❌ Error during Redis testing:', error);
    process.exit(1);
  } finally {
    await client.quit();
    console.log('\n👋 Connection closed.');
  }
}

testRedisConnection();
