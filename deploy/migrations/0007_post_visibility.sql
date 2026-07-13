ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(16) NOT NULL DEFAULT 'public';

UPDATE posts
SET visibility = 'public'
WHERE visibility IS NULL OR visibility NOT IN ('public', 'private');

ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_visibility_check;

ALTER TABLE posts
  ADD CONSTRAINT posts_visibility_check CHECK (visibility IN ('public', 'private'));

CREATE INDEX IF NOT EXISTS idx_posts_visibility_created_at
  ON posts (visibility, created_at DESC);
