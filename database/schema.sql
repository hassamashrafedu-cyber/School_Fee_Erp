CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- DEPENDENCY ORDER (fresh PostgreSQL install — run top to bottom)
-- =============================================================================
-- 1. institutes
-- 2. campuses → institutes
-- 3. academic_years, classes, sections → classes
-- 4. users (auth — no FKs; MUST exist before Step 10 migration/index)
-- 5. students → campuses, classes, sections
-- 6. student_academic_history → students, academic_years, classes, sections
-- 7. fee_types, expense_categories
-- 8. fee_structures → classes, academic_years
-- 9. fee_structure_items → fee_structures, fee_types
-- 10. student_fee_assignments → students, academic_years, fee_structures
-- 11. challans → students, academic_years
-- 12. challan_items → challans, fee_types
-- 13. payments → students, challans
-- 14. expenses → campuses, expense_categories
-- 15+ patches, fee_config, alumni, class_fee_components, fee_advance_links,
--     payment_allocations → payments, students, fee_advance_links
-- =============================================================================

-- STEP 1: Organization Structure
CREATE TABLE institutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE campuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institute_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  gender_type VARCHAR(10) NOT NULL,
  CONSTRAINT fk_campuses_institute
    FOREIGN KEY (institute_id)
    REFERENCES institutes(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_campuses_gender_type
    CHECK (gender_type IN ('boys', 'girls', 'mixed'))
);

CREATE INDEX idx_campuses_institute_id ON campuses (institute_id);

-- STEP 2: Academic System
CREATE TABLE academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(20) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_academic_years_name UNIQUE (name),
  CONSTRAINT chk_academic_years_date_range CHECK (end_date > start_date)
);

CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  level VARCHAR(20) NOT NULL,
  CONSTRAINT chk_classes_level CHECK (level IN ('school', 'college'))
);

CREATE TABLE sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL,
  name VARCHAR(25) NOT NULL,
  CONSTRAINT fk_sections_class
    FOREIGN KEY (class_id)
    REFERENCES classes(id)
    ON DELETE CASCADE,
  CONSTRAINT uq_sections_class_id_name UNIQUE (class_id, name)
);

CREATE INDEX idx_sections_class_id ON sections (class_id);

CREATE UNIQUE INDEX uq_academic_years_single_active
  ON academic_years (is_active)
  WHERE is_active = TRUE;

-- STEP 2.5: AUTH USERS (standalone — create before any ALTER/INDEX on users)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_users_role
    CHECK (role IN ('admin', 'accountant', 'staff')),
  CONSTRAINT chk_users_phone_not_empty
    CHECK (BTRIM(phone) <> '')
);

CREATE UNIQUE INDEX users_phone_unique ON users (phone);

-- STEP 3: STUDENTS & ACADEMIC HISTORY
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id UUID NOT NULL,
  current_class_id UUID NOT NULL,
  current_section_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  father_name VARCHAR(255) NOT NULL,
  phone VARCHAR(200),
  gender VARCHAR(10) NOT NULL,
  address TEXT,
  admission_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  CONSTRAINT fk_students_campus
    FOREIGN KEY (campus_id)
    REFERENCES campuses(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_students_current_class
    FOREIGN KEY (current_class_id)
    REFERENCES classes(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_students_current_section
    FOREIGN KEY (current_section_id)
    REFERENCES sections(id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_students_gender
    CHECK (gender IN ('male', 'female')),
  CONSTRAINT chk_students_status
    CHECK (status IN ('active', 'left'))
);

CREATE TABLE student_academic_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  class_id UUID NOT NULL,
  section_id UUID NOT NULL,
  result_status VARCHAR(20) NOT NULL,
  CONSTRAINT fk_student_academic_history_student
    FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_student_academic_history_academic_year
    FOREIGN KEY (academic_year_id)
    REFERENCES academic_years(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_student_academic_history_class
    FOREIGN KEY (class_id)
    REFERENCES classes(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_student_academic_history_section
    FOREIGN KEY (section_id)
    REFERENCES sections(id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_student_academic_history_result_status
    CHECK (result_status IN ('promoted', 'failed', 'left')),
  CONSTRAINT uq_student_academic_history_student_year
    UNIQUE (student_id, academic_year_id)
);

CREATE INDEX idx_students_campus_id ON students (campus_id);
CREATE INDEX idx_students_current_class_id ON students (current_class_id);
CREATE INDEX idx_students_current_section_id ON students (current_section_id);
CREATE INDEX idx_student_academic_history_student_id ON student_academic_history (student_id);
CREATE INDEX idx_student_academic_history_academic_year_id ON student_academic_history (academic_year_id);

-- 🔷 STEP 4: CONFIGURATION (ADMIN CONTROLLED)
CREATE TABLE fee_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_fee_types_name_not_empty CHECK (BTRIM(name) <> '')
);

CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_expense_categories_name_not_empty CHECK (BTRIM(name) <> '')
);

CREATE UNIQUE INDEX uq_fee_types_name_trimmed ON fee_types (BTRIM(name));
CREATE UNIQUE INDEX uq_expense_categories_name_trimmed ON expense_categories (BTRIM(name));

-- 🔷 STEP 5: FEE STRUCTURE (REFERENCE ONLY)
CREATE TABLE fee_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  CONSTRAINT fk_fee_structures_class
    FOREIGN KEY (class_id)
    REFERENCES classes(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_fee_structures_academic_year
    FOREIGN KEY (academic_year_id)
    REFERENCES academic_years(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_fee_structures_title_not_empty
    CHECK (BTRIM(title) <> ''),
  CONSTRAINT uq_fee_structures_class_year_title
    UNIQUE (class_id, academic_year_id, title)
);

CREATE TABLE fee_structure_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id UUID NOT NULL,
  fee_type_id UUID NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  is_monthly BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_fee_structure_items_structure
    FOREIGN KEY (structure_id)
    REFERENCES fee_structures(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_fee_structure_items_fee_type
    FOREIGN KEY (fee_type_id)
    REFERENCES fee_types(id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_fee_structure_items_amount_non_negative
    CHECK (amount >= 0),
  CONSTRAINT uq_fee_structure_items_structure_fee_type
    UNIQUE (structure_id, fee_type_id)
);

CREATE TABLE student_fee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  structure_id UUID NOT NULL,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_student_fee_assignments_student
    FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_student_fee_assignments_academic_year
    FOREIGN KEY (academic_year_id)
    REFERENCES academic_years(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_student_fee_assignments_structure
    FOREIGN KEY (structure_id)
    REFERENCES fee_structures(id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_student_fee_assignments_discount_non_negative
    CHECK (discount_amount >= 0),
  CONSTRAINT uq_student_fee_assignments_student_year
    UNIQUE (student_id, academic_year_id)
);

CREATE INDEX idx_fee_structures_class_id ON fee_structures (class_id);
CREATE INDEX idx_fee_structures_academic_year_id ON fee_structures (academic_year_id);
CREATE INDEX idx_fee_structure_items_structure_id ON fee_structure_items (structure_id);
CREATE INDEX idx_fee_structure_items_fee_type_id ON fee_structure_items (fee_type_id);
CREATE INDEX idx_student_fee_assignments_student_id ON student_fee_assignments (student_id);
CREATE INDEX idx_student_fee_assignments_academic_year_id ON student_fee_assignments (academic_year_id);

-- 🔷 STEP 6: CHALLAN SYSTEM (FLEXIBLE BILLING)
CREATE TABLE challans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  academic_year_id UUID NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE,
  month INTEGER,
  year INTEGER,
  notes TEXT,
  CONSTRAINT fk_challans_student
    FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_challans_academic_year
    FOREIGN KEY (academic_year_id)
    REFERENCES academic_years(id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_challans_due_date_not_before_issue_date
    CHECK (due_date IS NULL OR due_date >= issue_date),
  CONSTRAINT chk_challans_month_valid
    CHECK (month IS NULL OR month BETWEEN 1 AND 12),
  CONSTRAINT chk_challans_year_valid
    CHECK (year IS NULL OR year >= 2000)
);

CREATE TABLE challan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challan_id UUID NOT NULL,
  fee_type_id UUID NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  CONSTRAINT fk_challan_items_challan
    FOREIGN KEY (challan_id)
    REFERENCES challans(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_challan_items_fee_type
    FOREIGN KEY (fee_type_id)
    REFERENCES fee_types(id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_challan_items_amount_non_negative
    CHECK (amount >= 0)
);

CREATE INDEX idx_challans_student_id ON challans (student_id);
CREATE INDEX idx_challans_academic_year_id ON challans (academic_year_id);
CREATE INDEX idx_challans_month ON challans (month);
CREATE INDEX idx_challans_year ON challans (year);
CREATE INDEX idx_challan_items_challan_id ON challan_items (challan_id);
CREATE INDEX idx_challan_items_fee_type_id ON challan_items (fee_type_id);

-- 🔷 STEP 7: PAYMENTS (CORE LOGIC)
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  challan_id UUID,
  amount_paid NUMERIC(10,2) NOT NULL,
  payment_date DATE NOT NULL,
  method VARCHAR(20) NOT NULL,
  reference_no VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_student
    FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_payments_challan
    FOREIGN KEY (challan_id)
    REFERENCES challans(id)
    ON DELETE SET NULL,
  CONSTRAINT chk_payments_amount_paid_positive
    CHECK (amount_paid > 0),
  CONSTRAINT chk_payments_method
    CHECK (method IN ('cash', 'bank', 'online'))
);

CREATE INDEX idx_payments_student_id ON payments (student_id);
CREATE INDEX idx_payments_challan_id ON payments (challan_id);
CREATE INDEX idx_payments_payment_date ON payments (payment_date);

-- 🔷 STEP 8: EXPENSES
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id UUID NOT NULL,
  category_id UUID NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  date DATE NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expenses_campus
    FOREIGN KEY (campus_id)
    REFERENCES campuses(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_expenses_category
    FOREIGN KEY (category_id)
    REFERENCES expense_categories(id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_expenses_amount_positive
    CHECK (amount > 0)
);

CREATE INDEX idx_expenses_campus_id ON expenses (campus_id);
CREATE INDEX idx_expenses_category_id ON expenses (category_id);
CREATE INDEX idx_expenses_date ON expenses (date);

-- 🔷 CORE SYSTEM LOGIC (REFERENCE ONLY - DO NOT ENFORCE IN DB)
-- 💰 Fee Calculation:
-- Total Fee = SUM(challan_items.amount)
-- Total Paid = SUM(payments.amount_paid)
-- Remaining = Total Fee - Total Paid
-- 📊 Status Logic:
-- If Total Paid = 0 → Unpaid
-- If Total Paid < Total Fee → Partial
-- If Total Paid >= Total Fee → Paid
-- 🔁 Carry Forward Logic:
-- Next Month Fee = Current Month Fee + Previous Remaining

-- 🔷 STEP 9: DATABASE IMPROVEMENTS (SAFE PATCH)

ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE challans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS unique_fee_types_name_ci
ON fee_types (LOWER(TRIM(name)));

CREATE UNIQUE INDEX IF NOT EXISTS unique_expense_categories_name_ci
ON expense_categories (LOWER(TRIM(name)));

ALTER TABLE fee_structure_items
ALTER COLUMN amount TYPE NUMERIC(12,2);

ALTER TABLE challan_items
ALTER COLUMN amount TYPE NUMERIC(12,2);

ALTER TABLE payments
ALTER COLUMN amount_paid TYPE NUMERIC(12,2);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS selected_month INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS ledger_year INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type VARCHAR(20) DEFAULT 'payment';

ALTER TABLE expenses
ALTER COLUMN amount TYPE NUMERIC(12,2);

ALTER TABLE student_fee_assignments
ALTER COLUMN discount_amount TYPE NUMERIC(12,2);

ALTER TABLE fee_structures
ADD COLUMN IF NOT EXISTS start_month INTEGER;

ALTER TABLE fee_structures
ADD COLUMN IF NOT EXISTS end_month INTEGER;

ALTER TABLE fee_structures
ADD COLUMN IF NOT EXISTS year INTEGER;

ALTER TABLE fee_structures
ADD COLUMN IF NOT EXISTS month INTEGER;

ALTER TABLE fee_structures
ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2);

-- Manual fee structures: calendar year + optional NULL academic_year_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fee_structures'
      AND column_name = 'academic_year_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE fee_structures ALTER COLUMN academic_year_id DROP NOT NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_structures_class_calendar_year
ON fee_structures (class_id, year)
WHERE year IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_year_month
ON fee_structures (class_id, year, month)
WHERE year IS NOT NULL AND month IS NOT NULL;

ALTER TABLE student_fee_assignments
ADD COLUMN IF NOT EXISTS year INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_fee_assignments'
      AND column_name = 'academic_year_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE student_fee_assignments ALTER COLUMN academic_year_id DROP NOT NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_fee_assignments_student_calendar_year
ON student_fee_assignments (student_id, year)
WHERE year IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_fee_assignments'
      AND column_name = 'structure_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE student_fee_assignments ALTER COLUMN structure_id DROP NOT NULL;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS fee_config (
  year INTEGER PRIMARY KEY,
  start_month INTEGER NOT NULL,
  end_month INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_fee_config_start_month CHECK (start_month BETWEEN 1 AND 12),
  CONSTRAINT chk_fee_config_end_month CHECK (end_month BETWEEN 1 AND 12),
  CONSTRAINT chk_fee_config_range CHECK (start_month <= end_month)
);

-- Per-class billing month range for a year (overrides fee_config for that class only)
CREATE TABLE IF NOT EXISTS class_fee_billing_config (
  year INTEGER NOT NULL,
  class_id UUID NOT NULL,
  start_month INTEGER NOT NULL,
  end_month INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (year, class_id),
  CONSTRAINT chk_cfbc_start CHECK (start_month BETWEEN 1 AND 12),
  CONSTRAINT chk_cfbc_end CHECK (end_month BETWEEN 1 AND 12),
  CONSTRAINT chk_cfbc_range CHECK (start_month <= end_month),
  CONSTRAINT fk_cfbc_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payments_student_date
ON payments (student_id, payment_date);

CREATE INDEX IF NOT EXISTS idx_challans_student_year_month
ON challans (student_id, year, month);

ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

-- Widen phone for multiple comma-separated numbers (was VARCHAR(20); safe on existing DBs)
ALTER TABLE students
  ALTER COLUMN phone TYPE VARCHAR(200);

ALTER TABLE challans ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

-- NOTES (IMPORTANT FOR DEVELOPERS):
-- Soft delete usage:
-- Always filter active records:
-- SELECT * FROM table WHERE deleted_at IS NULL;
-- updated_at should be updated from backend on every update

-- STEP 4.1: Classes & sections soft delete columns
ALTER TABLE classes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- STEP 10: Auth users legacy migration (upgrade DBs created before password_hash column)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'password'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'password_hash'
  ) THEN
    EXECUTE 'ALTER TABLE users RENAME COLUMN password TO password_hash';
  END IF;
END
$$;

-- STEP 11: Alumni registry (year-wise graduation snapshots)
CREATE TABLE IF NOT EXISTS alumni (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  graduation_year INTEGER NOT NULL,
  class_id UUID,
  section_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_alumni_student
    FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alumni_student_graduation_year
ON alumni (student_id, graduation_year);

-- Extra fee columns per class/year (registration, heating, etc.); amounts add to each billing month total after monthly fee.
CREATE TABLE IF NOT EXISTS class_fee_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL,
  year INTEGER NOT NULL,
  label VARCHAR(120) NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  apply_month INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_class_fee_components_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT chk_cfc_amount CHECK (amount >= 0),
  CONSTRAINT chk_cfc_label CHECK (BTRIM(label) <> ''),
  CONSTRAINT chk_cfc_year CHECK (year >= 1900 AND year <= 2100),
  CONSTRAINT chk_cfc_apply_month CHECK (apply_month IS NULL OR (apply_month >= 1 AND apply_month <= 12))
);

CREATE INDEX IF NOT EXISTS idx_class_fee_components_class_year ON class_fee_components (class_id, year);

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_fee_components_class_year_label
ON class_fee_components (class_id, year, lower(trim(label)));

-- Per-month amount per extra column (replaces single amount + apply_month for billing math).
CREATE TABLE IF NOT EXISTS class_fee_component_month_amounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id UUID NOT NULL,
  month INTEGER NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_cfcm_component FOREIGN KEY (component_id) REFERENCES class_fee_components(id) ON DELETE CASCADE,
  CONSTRAINT chk_cfcm_month CHECK (month >= 1 AND month <= 12),
  CONSTRAINT chk_cfcm_amount CHECK (amount >= 0),
  CONSTRAINT uq_cfcm_component_month UNIQUE (component_id, month)
);

CREATE INDEX IF NOT EXISTS idx_cfcm_component ON class_fee_component_month_amounts (component_id);

-- Optional per-student overrides (calendar year) for monthly fee and admission fee column.
ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS admission_fee_override NUMERIC(12,2);
ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS admission_fee_override_by_month JSONB;
ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS override_amount_by_month JSONB;
ALTER TABLE student_fee_assignments ADD COLUMN IF NOT EXISTS advanced_fee_override_by_month JSONB;

-- Advance fee: optional class-level link from a billing month to a future month (policy).
CREATE TABLE IF NOT EXISTS fee_advance_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL,
  source_year INTEGER NOT NULL,
  source_month INTEGER NOT NULL,
  target_year INTEGER NOT NULL,
  target_month INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fee_advance_links_class
    FOREIGN KEY (class_id)
    REFERENCES classes(id)
    ON DELETE CASCADE,
  CONSTRAINT chk_fal_source_month CHECK (source_month >= 1 AND source_month <= 12),
  CONSTRAINT chk_fal_target_month CHECK (target_month >= 1 AND target_month <= 12),
  CONSTRAINT chk_fal_years CHECK (
    source_year >= 1900 AND source_year <= 2100
    AND target_year >= 1900 AND target_year <= 2100
  ),
  CONSTRAINT uq_fee_advance_links_class_src_tgt
    UNIQUE (class_id, source_year, source_month, target_year, target_month)
);

CREATE INDEX IF NOT EXISTS idx_fee_advance_links_class_source
  ON fee_advance_links (class_id, source_year, source_month);

CREATE INDEX IF NOT EXISTS idx_fee_advance_links_class_target
  ON fee_advance_links (class_id, target_year, target_month)
  WHERE active = TRUE;

-- Payment application to calendar months (supports split payments and advance credits).
CREATE TABLE IF NOT EXISTS payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL,
  student_id UUID NOT NULL,
  ledger_year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  allocation_kind VARCHAR(20) NOT NULL DEFAULT 'normal',
  fee_advance_link_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_allocations_payment
    FOREIGN KEY (payment_id)
    REFERENCES payments(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_payment_allocations_student
    FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_payment_allocations_fee_advance_link
    FOREIGN KEY (fee_advance_link_id)
    REFERENCES fee_advance_links(id)
    ON DELETE SET NULL,
  CONSTRAINT chk_pa_month CHECK (month >= 1 AND month <= 12),
  CONSTRAINT chk_pa_ledger_year CHECK (ledger_year >= 1900 AND ledger_year <= 2100),
  CONSTRAINT chk_pa_amount CHECK (amount > 0),
  CONSTRAINT chk_pa_allocation_kind
    CHECK (allocation_kind IN ('normal', 'advance', 'concession'))
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment
  ON payment_allocations (payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_student_ledger_month
  ON payment_allocations (student_id, ledger_year, month);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_kind
  ON payment_allocations (allocation_kind);

-- =============================================================================
-- STAFF PAYROLL (also in patch_staff_payroll.sql for existing installs)
-- =============================================================================
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

INSERT INTO expense_categories (name)
SELECT 'Staff Salaries'
WHERE NOT EXISTS (
  SELECT 1 FROM expense_categories WHERE LOWER(TRIM(name)) = LOWER('Staff Salaries')
);
