import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

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
