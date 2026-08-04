CREATE TABLE IF NOT EXISTS benefit_campaigns (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS benefit_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id VARCHAR(64) NOT NULL REFERENCES benefit_campaigns(id) ON DELETE RESTRICT,
  external_claim_id UUID NOT NULL UNIQUE,
  browser_key_hash VARCHAR(128) NOT NULL,
  network_key_hash VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  opus_user_id TEXT,
  opus_device_id TEXT,
  subscription_url_enc TEXT,
  expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, browser_key_hash),
  CHECK (status IN ('pending', 'provisioning', 'ready', 'failed', 'revoked', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_benefit_claims_network_created
ON benefit_claims (network_key_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_benefit_claims_status_updated
ON benefit_claims (status, updated_at DESC);

INSERT INTO benefit_campaigns (id, name, enabled)
VALUES ('webmaster-benefit-v1', '站长福利', false)
ON CONFLICT (id) DO NOTHING;
