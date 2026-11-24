-- Phase 1: Advance fee policy links + payment allocation lines (ledger truth per month).
-- Safe to run multiple times.

-- Policy: which calendar source month may credit which target month (e.g. Nov 2026 -> Jan 2027).
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

-- Facts: how each payment applies to (ledger_year, month). Sum per payment should equal payments.amount_paid.
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

-- One row per existing payment: same month/year logic as reportService / fee ledger (COALESCE ledger_year/selected_month).
INSERT INTO payment_allocations (
  id,
  payment_id,
  student_id,
  ledger_year,
  month,
  amount,
  allocation_kind,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  p.id,
  p.student_id,
  COALESCE(p.ledger_year, EXTRACT(YEAR FROM p.payment_date)::integer),
  COALESCE(p.selected_month, EXTRACT(MONTH FROM p.payment_date)::integer),
  p.amount_paid,
  'normal',
  p.created_at,
  COALESCE(p.updated_at, p.created_at)
FROM payments p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM payment_allocations pa WHERE pa.payment_id = p.id
  );
