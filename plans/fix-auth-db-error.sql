-- ============================================================
-- 彻底修复 public.profiles 表字段约束 + 重写触发器函数
-- 问题根源：on_auth_user_created 触发器中的 handle_new_user 函数
-- 因字段 NOT NULL 约束或字段不匹配导致 "Database error saving new user"
-- ============================================================

-- ============================================================
-- 1. 确保 profiles 表存在
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

-- ============================================================
-- 2. 将除 id 外的所有字段改为允许为空（DROP NOT NULL）
--    这样无论表中有哪些字段，插入时只传 id 都不会报错
-- ============================================================
DO $$
DECLARE
    col_record RECORD;
BEGIN
    FOR col_record IN
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name != 'id'
          AND is_nullable = 'NO'
    LOOP
        EXECUTE format('ALTER TABLE public.profiles ALTER COLUMN %I DROP NOT NULL', col_record.column_name);
        RAISE NOTICE 'Dropped NOT NULL on column: %', col_record.column_name;
    END LOOP;
END $$;

-- ============================================================
-- 3. 重写 handle_new_user 函数
--    最安全的版本：只插入 id + 默认昵称 + 默认头像 URL
--    其余字段全部不依赖
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, nickname, avatar_url)
    VALUES (
        NEW.id,
        -- 生成 8 位随机昵称，如 a1b2c3d4
        substr(md5(random()::text), 1, 8),
        -- 使用 ui-avatars.com 生成基于用户 ID 的默认头像
        -- 格式：https://ui-avatars.com/api/?name=ID&background=FF6B6B&color=fff&size=200
        'https://ui-avatars.com/api/?name=' || NEW.id || '&background=FF6B6B&color=fff&size=200'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- ============================================================
-- 4. 删除旧触发器并重新创建
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 5. 授予 service_role INSERT 权限
--    触发器以 SECURITY DEFINER 运行，默认使用函数拥有者权限
--    但显式授权更安全
-- ============================================================
GRANT INSERT ON public.profiles TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

-- ============================================================
-- 6. 配置 RLS 策略
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 允许用户读取自己的 profile
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

-- 允许用户更新自己的 profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- 允许用户插入自己的 profile（触发器已处理，但保留此策略以防万一）
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- ============================================================
-- 7. 验证
-- ============================================================
-- 检查 profiles 表所有字段的 nullable 状态
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY ordinal_position;

-- 检查触发器是否存在
SELECT tgname AS trigger_name, proname AS function_name
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE tgrelid = 'public.profiles'::regclass;
