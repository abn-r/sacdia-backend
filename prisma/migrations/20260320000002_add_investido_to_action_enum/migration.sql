-- Add INVESTIDO value to investiture_action_enum
-- Captures the final step when an approved enrollment is formally invested
-- by admin, marking the completion of the investiture process.

ALTER TYPE "investiture_action_enum" ADD VALUE IF NOT EXISTS 'INVESTIDO';
