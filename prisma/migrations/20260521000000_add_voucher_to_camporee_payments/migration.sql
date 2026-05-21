-- Add voucher attachment fields to camporee_payments
-- voucher_url: public/private R2 URL or object key of the uploaded receipt (image/PDF).
-- voucher_uploaded_at: timestamp when the voucher was attached or replaced.
ALTER TABLE camporee_payments
  ADD COLUMN IF NOT EXISTS voucher_url        VARCHAR(500),
  ADD COLUMN IF NOT EXISTS voucher_uploaded_at TIMESTAMPTZ;
