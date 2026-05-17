-- ============================================================
-- 修复 AI 口语对话历史记录删除权限
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 1. oral_sessions 表：添加 DELETE 策略
DROP POLICY IF EXISTS "oral_sessions_delete_own" ON public.oral_sessions;
CREATE POLICY "oral_sessions_delete_own" ON public.oral_sessions
    FOR DELETE USING (auth.uid()::TEXT = user_id);

-- 2. oral_messages 表：添加 DELETE 策略
DROP POLICY IF EXISTS "oral_messages_delete_own" ON public.oral_messages;
CREATE POLICY "oral_messages_delete_own" ON public.oral_messages
    FOR DELETE USING (auth.uid()::TEXT = user_id);

SELECT '✅ DELETE 策略添加成功' AS result;
