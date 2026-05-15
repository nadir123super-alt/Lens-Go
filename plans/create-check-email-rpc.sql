-- ============================================================
-- 创建 check_email_exists RPC 函数
-- 用途：在登录前检查邮箱是否已在 auth.users 中注册
-- 客户端无法直接查询 auth.users，需要通过 SECURITY DEFINER 函数
-- ============================================================

-- 删除已存在的函数（如果有）
DROP FUNCTION IF EXISTS public.check_email_exists;

-- 创建函数
-- SECURITY DEFINER: 以函数拥有者（默认 postgres）权限运行，可访问 auth.users
-- SET search_path = '': 防止搜索路径注入攻击
CREATE OR REPLACE FUNCTION public.check_email_exists(email_to_check TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    user_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM auth.users
        WHERE LOWER(email) = LOWER(TRIM(email_to_check))
    ) INTO user_exists;

    RETURN user_exists;
END;
$$;

-- 授予匿名用户和已认证用户执行权限
-- anon 用户需要此权限，因为在登录前用户尚未认证
GRANT EXECUTE ON FUNCTION public.check_email_exists TO anon;
GRANT EXECUTE ON FUNCTION public.check_email_exists TO authenticated;

-- ============================================================
-- 使用示例（在 Supabase SQL Editor 中执行）：
-- SELECT public.check_email_exists('user@example.com');
-- 返回 true 表示邮箱已注册，false 表示未注册
-- ============================================================
