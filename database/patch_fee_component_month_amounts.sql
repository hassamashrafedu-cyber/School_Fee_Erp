-- Per-month amounts for each extra fee column (Fine, Sports fund, etc.)

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
