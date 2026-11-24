-- School branding, fee-slip bank details, and academic year (single-row settings).
CREATE TABLE IF NOT EXISTS app_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  school_name TEXT NOT NULL DEFAULT '',
  school_name_line2 TEXT NOT NULL DEFAULT '',
  address_line1 TEXT NOT NULL DEFAULT '',
  address_line2 TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  academic_year TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  bank_account_no TEXT NOT NULL DEFAULT '',
  fine_type TEXT NOT NULL DEFAULT 'percent',
  fine_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  logo_data TEXT NULL,
  logo_mime TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
