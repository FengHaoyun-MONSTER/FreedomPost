ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'CNY';

ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_visibility_check;

ALTER TABLE posts
  ADD CONSTRAINT posts_visibility_check
  CHECK (visibility IN ('public', 'private', 'paid'));

ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_paid_price_check;

ALTER TABLE posts
  ADD CONSTRAINT posts_paid_price_check
  CHECK (
    (visibility = 'paid' AND price_cents > 0)
    OR (visibility <> 'paid' AND price_cents >= 0)
  );

CREATE TABLE IF NOT EXISTS reader_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login_name TEXT NOT NULL,
  normalized_login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reader_accounts_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT reader_accounts_credential_version_check CHECK (credential_version > 0)
);

CREATE TABLE IF NOT EXISTS reader_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES reader_accounts(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  credential_version INTEGER NOT NULL,
  user_agent_hash CHAR(64),
  ip_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reader_sessions_account_active
  ON reader_sessions (account_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS article_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code VARCHAR(24) NOT NULL UNIQUE,
  account_id UUID NOT NULL REFERENCES reader_accounts(id) ON DELETE RESTRICT,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
  post_title TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  CONSTRAINT article_orders_price_check CHECK (price_cents > 0),
  CONSTRAINT article_orders_status_check CHECK (status IN ('pending', 'completed', 'canceled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_article_orders_pending_account_post
  ON article_orders (account_id, post_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_article_orders_account_created
  ON article_orders (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_article_orders_status_created
  ON article_orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS article_entitlements (
  account_id UUID NOT NULL REFERENCES reader_accounts(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  source_order_id UUID REFERENCES article_orders(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by TEXT NOT NULL,
  PRIMARY KEY (account_id, post_id)
);

CREATE TABLE IF NOT EXISTS article_access_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_type VARCHAR(16) NOT NULL,
  actor_id TEXT,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT article_access_audit_actor_check CHECK (actor_type IN ('reader', 'admin', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_article_access_audit_target
  ON article_access_audit_log (target_type, target_id, created_at DESC);
