ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sold_count INT NOT NULL DEFAULT 0;

UPDATE products
SET sold_count = floor(random() * 251 + 50)::int
WHERE status = 'published' AND sold_count = 0;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS chk_products_sold_count;
ALTER TABLE products
  ADD CONSTRAINT chk_products_sold_count CHECK (sold_count >= 0);
