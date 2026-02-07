"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const redis_1 = require("redis");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
async function testRedisConnection() {
    console.log('🔍 Testing Upstash Redis connection...\n');
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        console.error('❌ REDIS_URL not found in .env file');
        process.exit(1);
    }
    console.log(`📡 Connecting to: ${redisUrl.replace(/:[^:]*@/, ':****@')}\n`);
    const client = (0, redis_1.createClient)({
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
        await client.connect();
        console.log('✅ Connected to Redis successfully!\n');
        console.log('Test 1: PING command');
        const pong = await client.ping();
        console.log(`  Response: ${pong}\n`);
        console.log('Test 2: SET command');
        await client.set('test:connection', 'Hello from NestJS!', {
            EX: 60,
        });
        console.log('  ✅ Key "test:connection" set successfully\n');
        console.log('Test 3: GET command');
        const value = await client.get('test:connection');
        console.log(`  Value: "${value}"\n`);
        console.log('Test 4: TTL command');
        const ttl = await client.ttl('test:connection');
        console.log(`  TTL: ${ttl} seconds\n`);
        console.log('Test 5: DEL command');
        await client.del('test:connection');
        console.log('  ✅ Key deleted successfully\n');
        console.log('📊 Redis Server Info:');
        const info = await client.info('server');
        const lines = info.split('\r\n');
        const redisVersion = lines.find((line) => line.startsWith('redis_version:'));
        const uptimeInDays = lines.find((line) => line.startsWith('uptime_in_days:'));
        if (redisVersion)
            console.log(`  ${redisVersion}`);
        if (uptimeInDays)
            console.log(`  ${uptimeInDays}`);
        console.log('\n🎉 All tests passed! Redis is ready to use.');
    }
    catch (error) {
        console.error('\n❌ Error during Redis testing:', error);
        process.exit(1);
    }
    finally {
        await client.quit();
        console.log('\n👋 Connection closed.');
    }
}
testRedisConnection();
//# sourceMappingURL=test-redis.js.map