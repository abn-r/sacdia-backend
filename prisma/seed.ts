import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join } from 'path';

const rolesCatalog = JSON.parse(
    readFileSync(join(__dirname, 'authz/roles.json'), 'utf8'),
) as Array<{
    role_name: string;
    description: string;
    role_category: 'GLOBAL' | 'CLUB';
    active: boolean;
}>;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🌱 Starting seed...');

    // Seed relationship_types
    console.log('📝 Seeding relationship_types...');
    await prisma.relationship_types.createMany({
        data: [
            {
                name: 'Padre',
                description: 'Padre biológico o adoptivo',
                active: true,
            },
            {
                name: 'Madre',
                description: 'Madre biológica o adoptiva',
                active: true,
            },
            {
                name: 'Tutor Legal',
                description: 'Tutor legal asignado por autoridad competente',
                active: true,
            },
            {
                name: 'Abuelo/a',
                description: 'Abuelo o abuela',
                active: true,
            },
            {
                name: 'Tío/a',
                description: 'Tío o tía',
                active: true,
            },
            {
                name: 'Hermano/a Mayor',
                description: 'Hermano o hermana mayor de edad',
                active: true,
            },
            {
                name: 'Otro',
                description: 'Otro tipo de relación',
                active: true,
            },
        ],
        skipDuplicates: true,
    });

    // Seed roles (Global + Club) — single source: prisma/authz/roles.json
    console.log('📝 Seeding roles (Global)...');
    await prisma.roles.createMany({
        data: rolesCatalog.filter((r) => r.role_category === 'GLOBAL'),
        skipDuplicates: true,
    });

    console.log('📝 Seeding roles (Club)...');
    await prisma.roles.createMany({
        data: rolesCatalog.filter((r) => r.role_category === 'CLUB'),
        skipDuplicates: true,
    });

    // Seed club_types
    console.log('📝 Seeding club_types...');
    await prisma.club_types.createMany({
        data: [
            { name: 'Aventureros', active: true },
            { name: 'Conquistadores', active: true },
            { name: 'Guías Mayores', active: true },
        ],
        skipDuplicates: true,
    });

    // Seed global annual ranking recognition tiers.
    // These are percentage bands calculated downward from each local field's annual max points.
    console.log('📝 Seeding ranking_tiers...');
    await prisma.$executeRaw`
        INSERT INTO ranking_tiers (name, slug, band_percentage, color, icon, sort_order, active)
        VALUES
            ('Diamante', 'diamante', 5.00, '#7DD3FC', 'diamond', 1, true),
            ('Oro', 'oro', 10.00, '#F59E0B', 'medal', 2, true),
            ('Plata', 'plata', 15.00, '#A8A29E', 'award', 3, true),
            ('Bronce', 'bronce', 20.00, '#B45309', 'badge', 4, true)
        ON CONFLICT (slug) DO UPDATE
        SET
            name = EXCLUDED.name,
            band_percentage = EXCLUDED.band_percentage,
            color = EXCLUDED.color,
            icon = EXCLUDED.icon,
            sort_order = EXCLUDED.sort_order,
            active = EXCLUDED.active,
            updated_at = now()
    `;

    // Seed countries
    console.log('📝 Seeding countries...');
    await prisma.countries.createMany({
        data: [
            { name: 'México', abbreviation: 'MX', active: true },
            { name: 'Estados Unidos', abbreviation: 'US', active: true },
            { name: 'Guatemala', abbreviation: 'GT', active: true },
            { name: 'Honduras', abbreviation: 'HN', active: true },
            { name: 'El Salvador', abbreviation: 'SV', active: true },
            { name: 'Nicaragua', abbreviation: 'NI', active: true },
            { name: 'Costa Rica', abbreviation: 'CR', active: true },
            { name: 'Panamá', abbreviation: 'PA', active: true },
        ],
        skipDuplicates: true,
    });

    // Seed admin user (super-admin)
    console.log('📝 Seeding admin user...');
    const adminEmail = 'admin@sacdia.com';
    const existingAdmin = await prisma.users.findUnique({
        where: { email: adminEmail },
    });

    if (!existingAdmin) {
        const adminId = randomUUID();
        const hashedPassword = await bcrypt.hash('Sacdia2026!', 12);

        await prisma.users.create({
            data: {
                user_id: adminId,
                email: adminEmail,
                name: 'Admin',
                paternal_last_name: 'SACDIA',
                email_verified: true,
                active: true,
                access_panel: true,
                approval_status: 'approved',
            },
        });

        await prisma.account.create({
            data: {
                id: randomUUID(),
                accountId: adminId,
                providerId: 'credential',
                userId: adminId,
                password: hashedPassword,
            },
        });

        const superAdminRole = await prisma.roles.findUnique({
            where: { role_name: 'super-admin' },
        });

        if (superAdminRole) {
            await prisma.users_roles.create({
                data: {
                    user_role_id: randomUUID(),
                    user_id: adminId,
                    role_id: superAdminRole.role_id,
                    active: true,
                },
            });
        }

        await prisma.users_pr.create({
            data: {
                user_id: adminId,
                complete: true,
                profile_picture_complete: true,
                personal_info_complete: true,
                club_selection_complete: true,
            },
        });

        console.log(`✅ Admin user created: ${adminEmail} (super-admin)`);
    } else {
        console.log(`⏭️  Admin user already exists: ${adminEmail}`);
    }

    // Seed test user for GM investiture tests
    console.log('📝 Seeding test user for GM investiture...');
    const TEST_USER_ID = 'a0000001-0000-4000-8000-000000000001';
    const testUserEmail = 'testuser.gm@sacdia.test';

    // Give the test user a territory: local-field scoped screens (reviews,
    // user detail) filter members by it. Real users get it at post-registration.
    const testUserLocalField = await prisma.local_fields.findFirst({
        where: { active: true },
        orderBy: { local_field_id: 'asc' },
        select: { local_field_id: true, union_id: true, unions: { select: { country_id: true } } },
    });
    const testUserTerritory = testUserLocalField
        ? {
              local_field_id: testUserLocalField.local_field_id,
              union_id: testUserLocalField.union_id,
              country_id: testUserLocalField.unions.country_id,
          }
        : {};

    await prisma.users.upsert({
        where: { user_id: TEST_USER_ID },
        create: {
            user_id: TEST_USER_ID,
            email: testUserEmail,
            name: 'Test',
            paternal_last_name: 'GM',
            email_verified: true,
            active: true,
            access_app: true,
            approval_status: 'approved',
            ...testUserTerritory,
        },
        update: {},
    });
    // Existing installs: fill the territory only where it is still empty.
    if (testUserLocalField) {
        await prisma.users.updateMany({
            where: { user_id: TEST_USER_ID, local_field_id: null },
            data: testUserTerritory,
        });
    }

    await prisma.account.upsert({
        where: { providerId_accountId: { providerId: 'credential', accountId: TEST_USER_ID } },
        create: {
            id: 'a0000001-0000-4000-8000-000000000002',
            accountId: TEST_USER_ID,
            providerId: 'credential',
            userId: TEST_USER_ID,
        },
        update: {},
    });

    await prisma.users_pr.upsert({
        where: { user_id: TEST_USER_ID },
        create: {
            user_id: TEST_USER_ID,
            complete: true,
            profile_picture_complete: true,
            personal_info_complete: true,
            club_selection_complete: true,
        },
        update: {},
    });

    // Seed a GM class for investiture enrollment
    console.log('📝 Seeding GM class for investiture tests...');
    const gmClubType = await prisma.club_types.findFirst({ where: { name: 'Guías Mayores' } });
    if (!gmClubType) {
        throw new Error('Guías Mayores club_type not found. Run club_types seed first.');
    }

    let gmClass = await prisma.classes.findFirst({
        where: { name: 'Guía Mayor - Nivel 1 (Seed)' },
    });

    if (!gmClass) {
        gmClass = await prisma.classes.create({
            data: {
                name: 'Guía Mayor - Nivel 1 (Seed)',
                description: 'Clase de prueba para tests de investidura GM',
                active: true,
                club_type_id: gmClubType.club_type_id,
                minimum_age: 16,
                requires_invested_gm: false,
                display_order: 1,
            },
        });
    }

    // Seed an ecclesiastical year for the enrollment
    console.log('📝 Seeding ecclesiastical year for investiture tests...');
    let seedYear = await prisma.ecclesiastical_years.findFirst({
        where: { year_id: 1 },
    });

    if (!seedYear) {
        seedYear = await prisma.ecclesiastical_years.create({
            data: {
                start_date: new Date('2026-01-01'),
                end_date: new Date('2026-12-31'),
                active: true,
            },
        });
    }

    // Seed GM investiture enrollment for the test user
    console.log('📝 Seeding GM investiture enrollment for test user...');
    await prisma.enrollments.upsert({
        where: {
            user_id_class_id_ecclesiastical_year_id: {
                user_id: TEST_USER_ID,
                class_id: gmClass.class_id,
                ecclesiastical_year_id: seedYear.year_id,
            },
        },
        create: {
            user_id: TEST_USER_ID,
            class_id: gmClass.class_id,
            ecclesiastical_year_id: seedYear.year_id,
            investiture_status: 'INVESTIDO',
            active: true,
        },
        update: {
            investiture_status: 'INVESTIDO',
            active: true,
        },
    });

    console.log(`✅ Test user ${TEST_USER_ID} seeded with INVESTIDO enrollment in class ${gmClass.class_id}.`);

    console.log('✅ Seed completed successfully!');
}

main()
    .catch((e) => {
        console.error('❌ Error during seed:');
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
