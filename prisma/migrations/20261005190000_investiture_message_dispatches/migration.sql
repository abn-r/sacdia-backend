-- One outbound investiture message per recipient, role, scope and scheduled execution.
CREATE TYPE "investiture_message_kind" AS ENUM ('PRESENTATION', 'REMINDER', 'RESULT');

CREATE TYPE "investiture_message_status" AS ENUM ('pending', 'sending', 'sent', 'failed', 'skipped');

CREATE TABLE "investiture_message_dispatches" (
    "dispatch_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "investiture_message_kind" NOT NULL,
    "execution_key" VARCHAR(120) NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "role" VARCHAR(40) NOT NULL,
    "scope_key" VARCHAR(80) NOT NULL,
    "status" "investiture_message_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "investiture_message_dispatches_pkey" PRIMARY KEY ("dispatch_id")
);

CREATE UNIQUE INDEX "uq_investiture_message_dispatch" ON "investiture_message_dispatches"("kind", "execution_key", "recipient_user_id", "role", "scope_key");

CREATE INDEX "idx_investiture_message_dispatches_status_kind" ON "investiture_message_dispatches"("status", "kind");
