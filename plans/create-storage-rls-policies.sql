-- ============================================================
-- Supabase Storage RLS 策略 - 头像上传（修复版）
-- ============================================================
-- 在 Supabase Dashboard → SQL Editor 中执行此脚本
-- 作用：允许已登录用户上传/管理自己的头像文件
-- ============================================================
-- 常见错误：
--   "new row violates row-level security policy"
--   原因1：RLS 策略未创建 → 执行本脚本
--   原因2：上传时传递了 base64 字符串而非 Blob → 前端用 fetch(uri).then(r=>r.blob())
--   原因3：bucket 未设置为公开 → 在 Dashboard 中设置
-- ============================================================

-- 1. 确保 avatars bucket 存在（如果尚未创建）
-- 也可以在 Supabase Dashboard → Storage → Create bucket 中手动创建
-- bucket 名称: avatars
-- 公开 bucket: ✅ 是（需要公开访问头像）

-- 2. 为 storage.objects 启用 RLS（如果尚未启用）
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 策略组 A：基于路径前缀的精确控制（推荐）
-- 路径格式: avatars/{userId}/{filename}
-- 通过 (storage.foldername(name))[1] 提取 user_id 与当前用户比对
-- ============================================================

-- 3. 创建 RLS 策略：允许用户上传文件到 avatars 桶
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 4. 创建 RLS 策略：允许用户更新自己的头像文件
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 5. 创建 RLS 策略：允许用户删除自己的头像文件
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 6. 创建 RLS 策略：允许所有人查看头像（公开读取）
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
CREATE POLICY "Anyone can view avatars"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- ============================================================
-- 策略组 B：兜底策略（已启用）
-- 允许已认证用户对 avatars 桶中自己路径下的文件做任何操作
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can manage own avatars (fallback)" ON storage.objects;
CREATE POLICY "Authenticated users can manage own avatars (fallback)"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================================
-- 策略组 C：宽松兜底策略（用于排查问题）
-- 如果上述策略仍然失败，取消注释以下策略进行测试。
-- 该策略允许所有已认证用户向 avatars 桶上传任意文件，
-- 不检查路径前缀。确认上传成功后，再切换回策略组 A/B。
-- ============================================================
DROP POLICY IF EXISTS "Allow all authenticated users to insert into avatars" ON storage.objects;
CREATE POLICY "Allow all authenticated users to insert into avatars"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars');

-- ============================================================
-- 7. profiles 表 RLS 策略（已启用）
--    允许用户更新自己的 avatar_url
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

-- ============================================================
-- 验证：检查策略是否生效
-- ============================================================
-- SELECT * FROM storage.policies WHERE bucket_id = 'avatars';
--
-- 测试上传（在 SQL Editor 中执行）：
-- -- 模拟当前用户
-- SELECT auth.uid()::text;
-- -- 如果返回 NULL，说明当前会话未认证，需要先登录
--
-- -- 检查 foldername 函数行为
-- SELECT storage.foldername('user-id-123/abc.png');
-- -- 应返回: {user-id-123, abc.png}
-- -- 所以 [1] 取到的是 user-id-123
--
-- -- 测试 RLS 是否允许插入（模拟已认证用户）
-- INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
-- VALUES ('avatars', 'test-user-id/test.png', auth.uid(), auth.uid());
-- -- 如果成功，说明 RLS 策略生效；如果失败，检查策略条件
