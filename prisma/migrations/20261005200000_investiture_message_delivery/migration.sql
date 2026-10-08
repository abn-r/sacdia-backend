-- Delivery tracking for investiture notices. Queued is not delivered.
-- A lease lets another worker reclaim a claim abandoned after a crash.
-- idempotency_key ties one inbox row to one result dispatch.
ALTER TYPE "investiture_message_status" ADD VALUE IF NOT EXISTS 'queued';

ALTER TABLE "investiture_message_dispatches"
    ADD COLUMN "lease_until" TIMESTAMPTZ(6),
    ADD COLUMN "claim_token" VARCHAR(80);

ALTER TABLE "notification_logs"
    ADD COLUMN "idempotency_key" VARCHAR(160);

CREATE UNIQUE INDEX "notification_logs_idempotency_key_key"
    ON "notification_logs"("idempotency_key");
