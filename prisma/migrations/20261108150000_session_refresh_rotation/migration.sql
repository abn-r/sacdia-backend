-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "previous_token" TEXT,
ADD COLUMN "rotated_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_previous_token_key" ON "sessions"("previous_token");
