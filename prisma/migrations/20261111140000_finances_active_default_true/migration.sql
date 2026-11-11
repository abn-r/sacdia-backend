-- Finance movements are active unless someone deactivates them. The service
-- already forces active = true on create; the column default now agrees.
-- Idempotent: SET DEFAULT can run any number of times. Existing rows are not touched.
ALTER TABLE "finances" ALTER COLUMN "active" SET DEFAULT true;
