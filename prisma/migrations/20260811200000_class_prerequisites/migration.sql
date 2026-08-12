-- Explicit class-to-class prerequisites (additive to requires_invested_gm).
CREATE TABLE "class_prerequisites" (
    "class_prerequisite_id" SERIAL PRIMARY KEY,
    "class_id" INTEGER NOT NULL,
    "prerequisite_class_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "class_prerequisites_class_id_fkey"
        FOREIGN KEY ("class_id") REFERENCES "classes"("class_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "class_prerequisites_prerequisite_class_id_fkey"
        FOREIGN KEY ("prerequisite_class_id") REFERENCES "classes"("class_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "class_prerequisites_no_self_reference"
        CHECK ("class_id" <> "prerequisite_class_id")
);

CREATE UNIQUE INDEX "class_prerequisites_class_id_prerequisite_class_id_key"
    ON "class_prerequisites"("class_id", "prerequisite_class_id");

CREATE INDEX "class_prerequisites_prerequisite_class_id_idx"
    ON "class_prerequisites"("prerequisite_class_id");
