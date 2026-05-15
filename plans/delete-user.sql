-- ============================================================
-- 创建 delete_user_self RPC 函数
-- 用途：用户自行注销账号，删除 auth.users 及所有关联数据
-- 客户端调用：supabase.rpc('delete_user_self')
-- ============================================================

-- 删除已存在的函数（如果有）
DROP FUNCTION IF EXISTS public.delete_user_self;

-- 创建函数
-- SECURITY DEFINER: 以函数拥有者权限运行，可访问 auth.users
-- SET search_path = '': 防止搜索路径注入攻击
CREATE OR REPLACE FUNCTION public.delete_user_self()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    uid UUID;
BEGIN
    -- 获取当前登录用户的 ID
    uid := auth.uid();

    -- 如果没有登录，拒绝操作
    IF uid IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 1. 删除关联的业务表数据（按外键依赖顺序）
    DELETE FROM public.user_achievements WHERE user_id = uid;
    DELETE FROM public.user_word_scores WHERE user_id = uid;
    DELETE FROM public.study_logs WHERE user_id = uid;
    DELETE FROM public.user_notebook WHERE user_id = uid;
    DELETE FROM public.profiles WHERE id = uid;

    -- 2. 删除 auth.users 中的用户记录
    --    注意：auth.users 有 CASCADE 删除关联的 session 和 refresh token
    DELETE FROM auth.users WHERE id = uid;

    RETURN TRUE;
END;
$$;

-- 授予已认证用户执行权限
GRANT EXECUTE ON FUNCTION public.delete_user_self TO authenticated;

-- ============================================================
-- 使用示例（客户端代码）：
-- const { data, error } = await supabase.rpc('delete_user_self');
-- if (error) { /* 处理错误 */ }
-- await supabase.auth.signOut();
-- router.replace('/login');
-- ============================================================
