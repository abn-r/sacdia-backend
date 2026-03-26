-- CreateTable
CREATE TABLE "finance_period_closings" (
    "finance_period_closing_id" SERIAL NOT NULL,
    "club_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "total_income" INTEGER NOT NULL,
    "total_expense" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "movement_count" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL,
    "closed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_period_closings_pkey" PRIMARY KEY ("finance_period_closing_id")
);

-- AlterTable
ALTER TABLE "finances" ADD COLUMN "post_closing_note" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "finance_period_closings_club_id_year_month_key" ON "finance_period_closings"("club_id", "year", "month");

-- CreateIndex
CREATE INDEX "finances_club_section_id_year_month_active_idx" ON "finances"("club_section_id", "year", "month", "active");

-- AddForeignKey
ALTER TABLE "finance_period_closings" ADD CONSTRAINT "finance_period_closings_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("club_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
