-- Run this in Supabase Dashboard → SQL Editor

-- 1. Add user_id to extractions
ALTER TABLE extractions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS extractions_user_id_idx ON extractions(user_id);

-- 2. Enable Row Level Security
ALTER TABLE extractions ENABLE ROW LEVEL SECURITY;

-- 3. Policies — users only see/write their own rows
CREATE POLICY "select_own" ON extractions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own" ON extractions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own" ON extractions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "delete_own" ON extractions
  FOR DELETE USING (auth.uid() = user_id);
