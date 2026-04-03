-- Discount Guard: Supabase database schema
-- Run this in the Supabase SQL editor after creating a new project

-- Merchants table
CREATE TABLE merchants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'basic', 'pro')),
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  settings JSONB DEFAULT '{"email_alerts": true, "auto_disable_codes": false, "abuse_threshold": 3}'::jsonb
);

CREATE INDEX idx_merchants_shop ON merchants(shop);

-- Orders table (stores hashed PII only)
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop TEXT NOT NULL,
  shopify_order_id TEXT NOT NULL,
  discount_code TEXT,
  customer_email TEXT NOT NULL,  -- SHA-256 hash
  customer_ip TEXT,              -- SHA-256 hash
  shipping_address_hash TEXT,    -- SHA-256 hash
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_shop ON orders(shop);
CREATE INDEX idx_orders_discount ON orders(shop, discount_code);
CREATE INDEX idx_orders_ip ON orders(shop, discount_code, customer_ip);
CREATE INDEX idx_orders_address ON orders(shop, discount_code, shipping_address_hash);
CREATE INDEX idx_orders_email ON orders(shop, discount_code, customer_email);

-- Abuse flags table
CREATE TABLE abuse_flags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('multi_account_same_ip', 'multi_account_same_address', 'excessive_use', 'public_share')),
  discount_code TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  severity TEXT DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high')),
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_flags_shop ON abuse_flags(shop);
CREATE INDEX idx_flags_unresolved ON abuse_flags(shop, resolved) WHERE resolved = FALSE;

-- Row Level Security (enable for production)
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE abuse_flags ENABLE ROW LEVEL SECURITY;

-- Service role can access everything (app server uses service role key)
CREATE POLICY "Service role full access" ON merchants FOR ALL USING (true);
CREATE POLICY "Service role full access" ON orders FOR ALL USING (true);
CREATE POLICY "Service role full access" ON abuse_flags FOR ALL USING (true);
