-- AlterTable
ALTER TABLE "club_sections"
  ADD COLUMN "name"     TEXT,
  ADD COLUMN "phone"    TEXT,
  ADD COLUMN "email"    TEXT,
  ADD COLUMN "website"  TEXT,
  ADD COLUMN "logo_url" TEXT,
  ADD COLUMN "address"  TEXT,
  ADD COLUMN "lat"      DOUBLE PRECISION,
  ADD COLUMN "long"     DOUBLE PRECISION;
