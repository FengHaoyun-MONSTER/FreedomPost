CREATE TABLE IF NOT EXISTS tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(64) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category VARCHAR(32) NOT NULL DEFAULT 'other',
  url TEXT NOT NULL,
  cover_url TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_tools_status CHECK (status IN ('draft', 'published'))
);

CREATE INDEX IF NOT EXISTS idx_tools_created_at ON tools (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tools_status_sort ON tools (status, sort_order, created_at DESC);
