-- Add new columns to budgets table
ALTER TABLE budgets ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'expense';
ALTER TABLE budgets ADD COLUMN is_global INTEGER NOT NULL DEFAULT 1;
ALTER TABLE budgets ADD COLUMN is_reusable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budgets ADD COLUMN rollover_type VARCHAR(50) NOT NULL DEFAULT 'disabled';
ALTER TABLE budgets ADD COLUMN category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

-- Create budget_allocations table
CREATE TABLE budget_allocations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create unique constraint: one allocation per budget-category pair
CREATE UNIQUE INDEX budget_allocations_budget_category_idx ON budget_allocations(budget_id, category_id);

-- Create budget_periods table
CREATE TABLE budget_periods (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    allocated_amount NUMERIC(15, 2) NOT NULL,
    rollover_amount NUMERIC(15, 2) DEFAULT 0,
    total_available NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for common queries
CREATE INDEX budget_allocations_budget_id_idx ON budget_allocations(budget_id);
CREATE INDEX budget_periods_budget_id_idx ON budget_periods(budget_id);
CREATE INDEX budget_periods_dates_idx ON budget_periods(period_start, period_end);
