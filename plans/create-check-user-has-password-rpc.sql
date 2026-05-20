-- ============================================================
-- 创建 check_user_has_password RPC 函数
-- 用途：检查用户是否已设置密码（即是否已完成注册）
-- 
-- 背景：
-- signInWithOtp({ shouldCreateUser: true }) 会在发送验证码时
-- 在 auth.users 中创建一条用户记录，但此时用户还没有设置密码。
-- 只有用户完成 verifyOtp + updateUser({ password }) 后，
-- encrypted_password 字段才会有值。
--
-- 这个函数用于区分：
--   - true:  用户已完成注册（有密码），应引导去登录
--   - false: 用户只获取了验证码但未完成注册，允许继续注册
-- ============================================================

-- 删除已存在的函数（如果有）
DROP FUNCTION IF EXISTS public.check_user_has_password;

-- 创建函数
-- SECURITY DEFINER: 以函数拥有者（默认 postgres）权限运行，可访问 auth.users
-- SET search_path = '': 防止搜索路径注入攻击
CREATE OR REPLACE FUNCTION public.check_user_has_password(email_to_check TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    has_pwd BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM auth.users
        WHERE LOWER(email) = LOWER(TRIM(email_to_check))
          AND encrypted_password IS NOT NULL
          AND encrypted_password != ''
    ) INTO has_pwd;

    RETURN has_pwd;
END;
$$;

-- 授予匿名用户和已认证用户执行权限
GRANT EXECUTE ON FUNCTION public.check_user_has_password TO anon;
GRANT EXECUTE ON FUNCTION public.check_user_has_password TO authenticated;

-- ============================================================
-- 使用示例（在 Supabase SQL Editor 中执行）：
-- SELECT public.check_user_has_password('user@example.com');
-- 返回 true 表示用户已设置密码（已完成注册）
-- 返回 false 表示用户未设置密码（未完成注册）
-- ============================================================
