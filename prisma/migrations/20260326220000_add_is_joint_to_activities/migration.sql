-- AlterTable: add is_joint flag to activities for joint multi-section activities
ALTER TABLE "activities" ADD COLUMN "is_joint" BOOLEAN NOT NULL DEFAULT false;
