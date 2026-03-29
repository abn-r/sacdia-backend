import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';

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

    // Seed roles (Global)
    console.log('📝 Seeding roles (Global)...');
    await prisma.roles.createMany({
        data: [
            {
                role_name: 'super_admin',
                role_category: 'GLOBAL',
                active: true,
            },
            {
                role_name: 'admin',
                role_category: 'GLOBAL',
                active: true,
            },
            {
                role_name: 'assistant_admin',
                role_category: 'GLOBAL',
                active: true,
            },
            {
                role_name: 'coordinator',
                role_category: 'GLOBAL',
                active: true,
            },
            {
                role_name: 'pastor',
                role_category: 'GLOBAL',
                active: true,
            },
            {
                role_name: 'user',
                role_category: 'GLOBAL',
                active: true,
            },
        ],
        skipDuplicates: true,
    });

    // Seed roles (Club)
    console.log('📝 Seeding roles (Club)...');
    await prisma.roles.createMany({
        data: [
            {
                role_name: 'director',
                role_category: 'CLUB',
                active: true,
            },
            {
                role_name: 'deputy_director',
                role_category: 'CLUB',
                active: true,
            },
            {
                role_name: 'secretary',
                role_category: 'CLUB',
                active: true,
            },
            {
                role_name: 'treasurer',
                role_category: 'CLUB',
                active: true,
            },
            {
                role_name: 'counselor',
                role_category: 'CLUB',
                active: true,
            },
            {
                role_name: 'instructor',
                role_category: 'CLUB',
                active: true,
            },
            {
                role_name: 'member',
                role_category: 'CLUB',
                active: true,
            },
        ],
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

    // Seed admin user (super_admin)
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
            where: { role_name: 'super_admin' },
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

        console.log(`✅ Admin user created: ${adminEmail} (super_admin)`);
    } else {
        console.log(`⏭️  Admin user already exists: ${adminEmail}`);
    }

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
