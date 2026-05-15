-- ============================================================
-- RLS 诊断脚本：检查 profiles 表的行级安全策略
-- 
-- 使用方法：
-- 1. 打开 Supabase Dashboard → SQL Editor
-- 2. 粘贴并运行此脚本
-- 3. 查看输出结果，确认 RLS 策略是否正确配置
-- ============================================================

-- 1. 检查 RLS 是否启用
SELECT
    relname AS table_name,
    relrowsecurity AS rls_enabled,
    relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relname = 'profiles';

-- 2. 列出所有已定义的 RLS 策略
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;

-- 3. 检查 profiles 表结构（确认 id 字段类型）
SELECT
    column_name,
    data_type,
    udt_name,
    character_maximum_length
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;

-- 4. 测试：以 authenticated 角色查询 profiles
-- 注意：在 Supabase SQL Editor 中运行时会自动使用当前会话角色
-- 如果 RLS 策略正确，应该能查到当前用户的 profile
SELECT current_user AS current_database_user,
       current_setting('role') AS current_role;

-- 5. 尝试直接查询 profiles 表（受 RLS 限制）
-- 如果 RLS 策略正确，只会返回当前用户的记录
SELECT id, email, nickname, created_at
FROM public.profiles
LIMIT 10;

-- 6. 检查是否有 handle_new_user 触发器
-- 这个触发器在用户注册时自动创建 profile 记录
SELECT
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement,
    action_timing
FROM information_schema.triggers
WHERE event_object_table = 'profiles';

-- ============================================================
-- 如果上述查询发现问题，使用以下修复语句：
-- ============================================================

-- 修复 1：确保 RLS 已启用
-- ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 修复 2：创建 SELECT 策略（允许 authenticated 用户读取自己的 profile）
-- CREATE POLICY "Users can read own profile"
-- ON public.profiles FOR SELECT TO authenticated
-- USING (id = auth.uid());

-- 修复 3：创建 INSERT 策略（允许 authenticated 用户插入自己的 profile）
-- CREATE POLICY "Users can insert own profile"
-- ON public.profiles FOR INSERT TO authenticated
-- WITH CHECK (id = auth.uid());

-- 修复 4：创建 UPDATE 策略（允许 authenticated 用户更新自己的 profile）
-- CREATE POLICY "Users can update own profile"
-- ON public.profiles FOR UPDATE TO authenticated
-- USING (id = auth.uid())
-- WITH CHECK (id = auth.uid());

-- 修复 5：创建触发器函数（用户注册时自动创建 profile）
-- CREATE OR REPLACE FUNCTION public.handle_new_user()
-- RETURNS trigger AS $$
-- BEGIN
--   INSERT INTO public.profiles (id, email, nickname)
--   VALUES (
--     NEW.id,
--     NEW.email,
--     COALESCE(NEW.raw_user_meta_data->>'nickname', '用户' || substr(NEW.id::text, 1, 8))
--   );
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;

-- 修复 6：创建触发器
-- CREATE OR REPLACE TRIGGER on_auth_user_created
--   AFTER INSERT ON auth.users
--   FOR EACH ROW
--   EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 紧急调试：如果上述策略都正确但仍无法查询，可以临时禁用 RLS
-- 注意：仅用于调试，生产环境请勿使用！
-- ============================================================
-- ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
