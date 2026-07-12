ALTER TABLE products
  ADD COLUMN IF NOT EXISTS commission_cents INT NOT NULL DEFAULT 0;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sold_count INT NOT NULL DEFAULT 0;

UPDATE products
SET sold_count = floor(random() * 251 + 50)::int
WHERE status = 'published' AND sold_count = 0;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS chk_products_sold_count;
ALTER TABLE products
  ADD CONSTRAINT chk_products_sold_count CHECK (sold_count >= 0);

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS chk_products_commission;
ALTER TABLE products
  ADD CONSTRAINT chk_products_commission CHECK (commission_cents >= 0);

CREATE TABLE IF NOT EXISTS affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wechat_id VARCHAR(32) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_affiliates_status CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_affiliates_status ON affiliates (status);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  visitor_key VARCHAR(128) NOT NULL,
  path TEXT NOT NULL DEFAULT '/market/',
  is_unique INT NOT NULL DEFAULT 0,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_affiliate_click_unique CHECK (is_unique IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_affiliate_time
  ON affiliate_clicks (affiliate_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_visitor_time
  ON affiliate_clicks (affiliate_id, visitor_key, clicked_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code VARCHAR(16) NOT NULL UNIQUE,
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_title TEXT NOT NULL,
  price_cents INT NOT NULL,
  commission_cents INT NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
  order_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  commission_status VARCHAR(16) NOT NULL DEFAULT 'not_due',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  commission_paid_at TIMESTAMPTZ,
  CONSTRAINT chk_affiliate_orders_price CHECK (price_cents >= 0),
  CONSTRAINT chk_affiliate_orders_commission CHECK (commission_cents >= 0),
  CONSTRAINT chk_affiliate_orders_status CHECK (order_status IN ('pending', 'completed', 'canceled')),
  CONSTRAINT chk_affiliate_commission_status CHECK (commission_status IN ('not_due', 'pending', 'paid'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_orders_affiliate
  ON affiliate_orders (affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_orders_status
  ON affiliate_orders (order_status, commission_status, created_at DESC);
