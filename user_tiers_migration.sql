-- Create user_tiers table
CREATE TABLE IF NOT EXISTS user_tiers (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'growth', 'pro', 'elite', 'team', 'desk', 'enterprise')),
  reports_used_this_month INT NOT NULL DEFAULT 0,
  billing_cycle_start DATE NOT NULL DEFAULT CURRENT_DATE,
  razorpay_payment_id TEXT,
  razorpay_order_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_tiers ENABLE ROW LEVEL SECURITY;

-- Users can only read their own tier
CREATE POLICY "Users can read own tier"
  ON user_tiers FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role can insert/update (via backend webhook)
CREATE POLICY "Service role can manage tiers"
  ON user_tiers FOR ALL
  USING (true)
  WITH CHECK (true);

-- Function to reset monthly usage on billing cycle
CREATE OR REPLACE FUNCTION reset_monthly_usage()
RETURNS void AS $$
  UPDATE user_tiers
  SET reports_used_this_month = 0,
      billing_cycle_start = CURRENT_DATE
  WHERE billing_cycle_start < date_trunc('month', CURRENT_DATE);
$$ LANGUAGE sql;
