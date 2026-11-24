-- Staff payroll: master staff + monthly salary runs that post into expenses on pay.
-- Safe to re-run. Does not alter existing expenses CRUD behavior.

CREATE TABLE IF NOT EXISTS staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  monthly_salary NUMERIC(12, 2) NOT NULL,
  absent_deduction_per_day NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_staff_members_name_not_empty CHECK (BTRIM(name) <> ''),
  CONSTRAINT chk_staff_members_salary_positive CHECK (monthly_salary > 0),
  CONSTRAINT chk_staff_members_absent_day_nonneg CHECK (absent_deduction_per_day >= 0)
);

CREATE INDEX IF NOT EXISTS idx_staff_members_active_name
  ON staff_members (is_active, name);

CREATE TABLE IF NOT EXISTS staff_salary_months (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  base_salary NUMERIC(12, 2) NOT NULL,
  absent_deduction_per_day NUMERIC(12, 2) NOT NULL DEFAULT 0,
  absent_days INTEGER NOT NULL DEFAULT 0,
  deduction_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  payable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  expense_id UUID NULL,
  paid_at TIMESTAMP NULL,
  paid_by UUID NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_staff_salary_months_staff
    FOREIGN KEY (staff_id) REFERENCES staff_members(id) ON DELETE RESTRICT,
  CONSTRAINT fk_staff_salary_months_expense
    FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE SET NULL,
  CONSTRAINT fk_staff_salary_months_paid_by
    FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_staff_salary_months_staff_year_month UNIQUE (staff_id, year, month),
  CONSTRAINT chk_staff_salary_months_year CHECK (year >= 1900 AND year <= 2100),
  CONSTRAINT chk_staff_salary_months_month CHECK (month >= 1 AND month <= 12),
  CONSTRAINT chk_staff_salary_months_absent_days CHECK (absent_days >= 0 AND absent_days <= 31),
  CONSTRAINT chk_staff_salary_months_amounts_nonneg CHECK (
    base_salary >= 0
    AND absent_deduction_per_day >= 0
    AND deduction_amount >= 0
    AND payable_amount >= 0
  ),
  CONSTRAINT chk_staff_salary_months_status CHECK (status IN ('draft', 'paid'))
);

CREATE INDEX IF NOT EXISTS idx_staff_salary_months_year_month
  ON staff_salary_months (year, month);

CREATE INDEX IF NOT EXISTS idx_staff_salary_months_expense_id
  ON staff_salary_months (expense_id)
  WHERE expense_id IS NOT NULL;

-- System category used when salaries are posted to expenses.
INSERT INTO expense_categories (name)
SELECT 'Staff Salaries'
WHERE NOT EXISTS (
  SELECT 1 FROM expense_categories WHERE LOWER(TRIM(name)) = LOWER('Staff Salaries')
);
