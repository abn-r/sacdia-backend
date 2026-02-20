"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = __importDefault(require("pg"));
const pool = new pg_1.default.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function verifyFcmMigration() {
    console.log('🔍 Verifying user_fcm_tokens migration...');
    const tableCheck = await prisma.$queryRawUnsafe(`SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'user_fcm_tokens'
    ) AS exists;`);
    const hasTable = tableCheck[0]?.exists === true;
    console.log(`- Table user_fcm_tokens: ${hasTable ? 'OK' : 'MISSING'}`);
    const indexRows = await prisma.$queryRawUnsafe(`SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'user_fcm_tokens';`);
    const indexNames = indexRows.map((row) => row.indexname);
    const expectedIndexes = [
        'idx_user_fcm_tokens_user_id',
        'idx_user_fcm_tokens_active',
    ];
    for (const expected of expectedIndexes) {
        const exists = indexNames.includes(expected);
        console.log(`- Index ${expected}: ${exists ? 'OK' : 'MISSING'}`);
    }
    const ready = hasTable && expectedIndexes.every((expected) => indexNames.includes(expected));
    if (!ready) {
        process.exitCode = 1;
        console.error('❌ FCM migration verification failed');
        return;
    }
    console.log('✅ FCM migration verification passed');
}
verifyFcmMigration()
    .catch((error) => {
    console.error('❌ Error verifying FCM migration:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
});
//# sourceMappingURL=verify-fcm-migration.js.map