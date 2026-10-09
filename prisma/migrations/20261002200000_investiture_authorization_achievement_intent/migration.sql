-- Durable class.completed intent for an authorization decision, and one event row per intent.
ALTER TABLE "investiture_authorization_people"
ADD COLUMN "achievement_intent_key" VARCHAR(80);

CREATE UNIQUE INDEX "investiture_authorization_people_achievement_intent_key_key"
ON "investiture_authorization_people"("achievement_intent_key");

ALTER TABLE "achievement_event_log"
ADD COLUMN "idempotency_key" VARCHAR(120);

CREATE UNIQUE INDEX "achievement_event_log_idempotency_key_key"
ON "achievement_event_log"("idempotency_key");
