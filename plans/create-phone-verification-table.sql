-- ============================================================
-- 手机号验证码表
-- 用于存储短信验证码，支持手机号登录/注册
-- ============================================================

CREATE TABLE IF NOT EXISTS phone_verification_codes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone TEXT NOT NULL,                      -- 手机号
  code TEXT NOT NULL,                       -- 6位验证码
  expires_at TIMESTAMPTZ NOT NULL,          -- 过期时间
  used BOOLEAN NOT NULL DEFAULT FALSE,      -- 是否已使用
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- 索引：按手机号查询未使用的验证码
  CONSTRAINT idx_phone_unused UNIQUE (phone, code)
);

-- 按手机号查询最近的验证码
CREATE INDEX IF NOT EXISTS idx_phone_verification_phone 
  ON phone_verification_codes(phone, created_at DESC);

-- ============================================================
-- RPC：验证手机验证码
-- ============================================================
CREATE OR REPLACE FUNCTION verify_phone_code(
  p_phone TEXT,
  p_code TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_valid BOOLEAN;
BEGIN
  -- 查找未使用且未过期的验证码
  SELECT EXISTS (
    SELECT 1 FROM phone_verification_codes
    WHERE phone = p_phone
      AND code = p_code
      AND used = FALSE
      AND expires_at > NOW()
  ) INTO v_valid;
  
  -- 如果验证成功，标记为已使用
  IF v_valid THEN
    UPDATE phone_verification_codes
    SET used = TRUE
    WHERE phone = p_phone AND code = p_code;
  END IF;
  
  RETURN v_valid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC：检查手机号是否已注册
-- ============================================================
CREATE OR REPLACE FUNCTION check_phone_exists(
  p_phone TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE phone = p_phone
  ) INTO v_exists;
  
  RETURN v_exists;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RLS 策略
-- ============================================================
ALTER TABLE phone_verification_codes ENABLE ROW LEVEL SECURITY;

-- 允许匿名用户插入验证码（通过 Edge Function 调用）
CREATE POLICY "允许 Edge Function 插入验证码"
  ON phone_verification_codes
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- 允许匿名用户查询和更新验证码（通过 verify_phone_code RPC）
CREATE POLICY "允许匿名用户查询验证码"
  ON phone_verification_codes
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "允许匿名用户更新验证码"
  ON phone_verification_codes
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
