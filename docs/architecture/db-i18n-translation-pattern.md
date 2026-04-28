# DB i18n Translation Pattern — Approach X

> Phase A pilot: `honors_categories_translations`. Phase B extends this to 26 remaining catalogs.

## Approach X: Spanish stays in main table

Spanish (`es`) is the source language and the only locale stored in main table columns (`name`, `description`, etc.). The `<entity>_translations` table holds **only non-`es` locales** (`en`, `pt-BR`, `fr`, …).

This means:
- When request locale is `es` → no JOIN, return main table columns directly (zero overhead).
- When request locale is non-`es` → JOIN translations table, overlay only fields that have a non-null translation row. If no row exists for the locale, fall back to Spanish transparently.
- A DB-level `CHECK` constraint (`locale <> 'es'`) enforces this invariant — no accidental `es` rows in the translations table.

## Schema Shape (canonical example: `honors_categories`)

```sql
-- Main table (unchanged): Spanish stays here
CREATE TABLE "honors_categories" (
  "honor_category_id" SERIAL PRIMARY KEY,
  "name"              VARCHAR(100) UNIQUE NOT NULL,
  "description"       TEXT,
  ...
);

-- Translation table: only non-es locales
CREATE TABLE "honors_categories_translations" (
  "id"                SERIAL PRIMARY KEY,
  "honor_category_id" INTEGER NOT NULL,
  "locale"            VARCHAR(10) NOT NULL,
  "name"              VARCHAR(100),
  "description"       TEXT,
  "created_at"        TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ(6) DEFAULT NOW(),
  CONSTRAINT "honors_categories_translations_honor_category_id_fkey"
    FOREIGN KEY ("honor_category_id")
    REFERENCES "honors_categories" ("honor_category_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "honors_categories_translations_unique_locale"
    UNIQUE ("honor_category_id", "locale"),
  CONSTRAINT "honors_categories_translations_locale_not_es"
    CHECK ("locale" <> 'es')
);

CREATE INDEX ON "honors_categories_translations" ("locale");
CREATE INDEX ON "honors_categories_translations" ("honor_category_id");
```

## Prisma Model (canonical example)

```prisma
model honors_categories {
  honor_category_id Int                              @id @default(autoincrement())
  name              String                           @unique @db.VarChar(100)
  description       String?
  ...
  translations      honors_categories_translations[]
}

model honors_categories_translations {
  id                Int               @id @default(autoincrement())
  honor_category_id Int
  locale            String            @db.VarChar(10)
  name              String?           @db.VarChar(100)
  description       String?
  created_at        DateTime?         @default(now()) @db.Timestamptz(6)
  updated_at        DateTime?         @default(now()) @db.Timestamptz(6)
  honors_categories honors_categories @relation(fields: [honor_category_id], references: [honor_category_id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([honor_category_id, locale])
  @@index([locale])
  @@index([honor_category_id])
}
```

## TranslationService Usage in Service Layer

`TranslationService` is registered in `@Global() CommonModule` — inject it anywhere without additional imports.

```typescript
// Constructor injection
constructor(
  private readonly prisma: PrismaService,
  private readonly translationService: TranslationService,
) {}

// In a findMany method
async getCategories() {
  const locale = this.translationService.getCurrentLocale(); // reads I18nContext.current()?.lang

  const records = await this.prisma.honors_categories.findMany({
    where: { active: true },
    select: {
      honor_category_id: true,
      name: true,
      description: true,
      icon: true,
      translations: {
        where: { locale },             // filter at DB level — 0 or 1 row per record
        select: { locale: true, name: true, description: true },
      },
    },
    orderBy: { name: 'asc' },
    take: 200,
  });

  // translateMany: overlays fields and strips the `translations` array from output
  return this.translationService.translateMany(
    records,
    locale,
    ['name', 'description'],  // fields to overlay
    'translations',            // key holding the embedded translations array
  );
}
```

### TranslationService API surface

| Method | Description |
|--------|-------------|
| `getCurrentLocale(): string` | Returns `I18nContext.current()?.lang ?? 'es'`. Falls back to `'es'` in jobs with no request context. |
| `translate<T, K>(record, translations, locale, fields): T` | Overlays a single record. No-op for `es` or missing translation. |
| `translateMany<T, K>(records, locale, fields, translationsKey): Omit<T, key>[]` | Applies translate to a list and strips the internal translations array. |

## Naming Convention

```
<entity>_translations
```

Examples: `honors_categories_translations`, `activity_types_translations`, `club_types_translations`.

The `<entity>` matches the main table name exactly.

## Migration Apply Instructions (Neon / manual psql)

Shadow DB is broken on this project. Migrations are applied manually.

```bash
# Dev branch only (staging/production deferred to Phase B sign-off)
psql "$DATABASE_URL" -f prisma/migrations/<timestamp>_<name>/migration.sql

# Verify table
echo "SELECT table_name FROM information_schema.tables WHERE table_name = '<entity>_translations';" \
  | psql "$DATABASE_URL"

# Regenerate Prisma client after schema update
pnpm exec prisma generate
```

Never run `prisma migrate deploy` against Neon — it will error on shadow DB creation.

## Phase B Checklist (26 remaining catalogs)

For each new catalog entity:
1. Create `prisma/migrations/<ts>_<entity>_translations/migration.sql` using the canonical SQL above.
2. Add the Prisma model pair (main table relation field + translations model).
3. Apply migration to dev: `psql "$DATABASE_URL" -f migration.sql`.
4. Run `pnpm exec prisma generate`.
5. In the catalog's service, inject `TranslationService` and wrap the `findMany` with `translateMany`.
6. Optionally seed a few translation rows for smoke testing.

## Approach X Reasoning

- **Simplicity**: No schema change to the main table. Spanish callers pay zero cost (no JOIN, no overlay logic).
- **Fallback is implicit**: If a translation row is missing for a locale, the service returns Spanish without extra branching.
- **DB integrity**: `CHECK (locale <> 'es')` makes it impossible to accidentally duplicate Spanish data in the translations table.
- **Incremental rollout**: Each catalog can be migrated independently. Catalogs not yet in Phase B still work — they just always return Spanish.
