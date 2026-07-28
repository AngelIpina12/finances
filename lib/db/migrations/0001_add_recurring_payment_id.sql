-- Add recurring_payment_id column to transactions table
ALTER TABLE "transactions" ADD COLUMN "recurring_payment_id" uuid REFERENCES "recurring_payments"("id") ON DELETE cascade;
