-- An ambiguous provider accept is not a new send and not a confirmed delivery.
ALTER TYPE "investiture_message_status" ADD VALUE IF NOT EXISTS 'uncertain';
