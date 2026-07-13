ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS default_markup_percent INT NOT NULL DEFAULT 0;

ALTER TABLE affiliates
  DROP CONSTRAINT IF EXISTS chk_affiliates_markup_percent;
ALTER TABLE affiliates
  ADD CONSTRAINT chk_affiliates_markup_percent CHECK (default_markup_percent >= 0 AND default_markup_percent <= 1000);

CREATE TABLE IF NOT EXISTS affiliate_product_markups (
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  markup_percent INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (affiliate_id, product_id),
  CONSTRAINT chk_affiliate_product_markup_percent CHECK (markup_percent >= 0 AND markup_percent <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_markups_affiliate
  ON affiliate_product_markups (affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_product_markups_product
  ON affiliate_product_markups (product_id);
