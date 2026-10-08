-- BCR-5. No aplicada en Neon.
-- Registra la corrida diaria de recordatorios por Campo, rol y día local. Con la fila
-- presente, la corrida del día ya ocurrió y no se generan recordatorios tardíos para
-- destinatarios nuevos. La clave primaria deja que solo una instancia reclame el día.

CREATE TABLE "investiture_reminder_runs" (
    "local_field_id" INTEGER NOT NULL,
    "role" VARCHAR(40) NOT NULL,
    "local_date" VARCHAR(10) NOT NULL,
    "ran_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investiture_reminder_runs_pkey" PRIMARY KEY ("local_field_id", "role", "local_date")
);

ALTER TABLE "investiture_reminder_runs"
ADD CONSTRAINT "investiture_reminder_runs_local_field_id_fkey"
FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
ON DELETE CASCADE ON UPDATE NO ACTION;
