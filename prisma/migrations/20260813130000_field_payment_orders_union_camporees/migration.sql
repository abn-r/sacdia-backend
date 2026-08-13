-- Field payment orders v1.1: soporte para camporees de unión (opción A).
-- El campo local sigue cobrando; la orden puede referenciar un camporee de
-- unión en lugar de uno local. Expand-only: columna nueva + FK + CHECK
-- reconstruido para exigir exactamente una referencia por propósito.

ALTER TABLE "field_payment_orders"
    ADD COLUMN IF NOT EXISTS "union_camporee_id" INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'field_payment_orders_union_camporee_id_fkey'
    ) THEN
        ALTER TABLE "field_payment_orders"
            ADD CONSTRAINT "field_payment_orders_union_camporee_id_fkey"
            FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
    END IF;
END $$;

ALTER TABLE "field_payment_orders"
    DROP CONSTRAINT IF EXISTS "field_payment_orders_purpose_ref_check";
ALTER TABLE "field_payment_orders"
    ADD CONSTRAINT "field_payment_orders_purpose_ref_check"
    CHECK (
        (
            "purpose" = 'INSURANCE'
            AND "insurance_cycle_config_id" IS NOT NULL
            AND "local_camporee_id" IS NULL
            AND "union_camporee_id" IS NULL
        )
        OR (
            "purpose" = 'CAMPOREE'
            AND "insurance_cycle_config_id" IS NULL
            AND (
                ("local_camporee_id" IS NOT NULL AND "union_camporee_id" IS NULL)
                OR ("local_camporee_id" IS NULL AND "union_camporee_id" IS NOT NULL)
            )
        )
    );

CREATE INDEX IF NOT EXISTS "idx_field_payment_orders_union_camporee"
    ON "field_payment_orders"("union_camporee_id")
    WHERE "union_camporee_id" IS NOT NULL;
