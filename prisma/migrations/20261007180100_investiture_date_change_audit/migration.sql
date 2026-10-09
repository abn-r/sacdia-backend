-- BC-13. No aplicada en Neon.
-- Guarda quién cambió la fecha de investidura y el instante del reloj de la aplicación.

ALTER TABLE "investiture_authorization_people"
ADD COLUMN "date_changed_by_id" UUID,
ADD COLUMN "date_changed_at" TIMESTAMPTZ(6);
