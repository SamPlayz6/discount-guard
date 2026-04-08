-- Shopify session storage (replaces in-memory Map)
-- Used by the Shopify OAuth flow to persist sessions across server restarts

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_shop ON sessions(shop);
CREATE INDEX idx_sessions_expires ON sessions(expires_at) WHERE expires_at IS NOT NULL;

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_sessions_updated_at();

-- Clean up expired sessions periodically (optional cron via pg_cron)
-- SELECT cron.schedule('clean-expired-sessions', '0 */6 * * *',
--   $$DELETE FROM sessions WHERE expires_at < NOW()$$);
