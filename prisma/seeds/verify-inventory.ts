import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const categories = await prisma.inventory_categories.findMany({
    where: { active: true },
    orderBy: { inventory_category_id: "asc" },
    select: { inventory_category_id: true, name: true },
  });

  console.log("\n=== inventory_categories ===");
  categories.forEach((c) =>
    console.log(`  [${c.inventory_category_id}] ${c.name}`)
  );

  const items = await prisma.club_inventory.findMany({
    where: { club_section_id: 1, active: true },
    orderBy: { club_inventory_id: "asc" },
    select: {
      club_inventory_id: true,
      name: true,
      amount: true,
      inventory_categories: { select: { name: true } },
    },
  });

  console.log(
    `\n=== club_inventory (club_section_id=1) — ${items.length} items ===`
  );
  items.forEach((i) =>
    console.log(
      `  [${i.club_inventory_id}] ${i.name} (x${i.amount}) — ${i.inventory_categories?.name ?? "sin categoría"}`
    )
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
