-- BC-14. No aplicada en Neon.
-- Antes de aplicarla, confirmar que no hay huérfanos:
-- SELECT p.user_id
-- FROM district_investiture_pastors p
-- LEFT JOIN users u ON u.user_id = p.user_id
-- WHERE u.user_id IS NULL;

ALTER TABLE "district_investiture_pastors"
ADD CONSTRAINT "district_investiture_pastors_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("user_id")
ON DELETE RESTRICT ON UPDATE NO ACTION;
