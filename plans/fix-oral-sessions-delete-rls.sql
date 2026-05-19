-- ============================================================
-- 修复 oral_sessions 表缺少 DELETE RLS 策略的问题
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 为 oral_sessions 表添加 DELETE 策略
DROP POLICY IF EXISTS "oral_sessions_delete_own" ON public.oral_sessions;
CREATE POLICY "oral_sessions_delete_own" ON public.oral_sessions
    FOR DELETE USING (auth.uid()::text = user_id::text);

-- 为 oral_messages 表添加 DELETE 策略  
DROP POLICY IF EXISTS "oral_messages_delete_own" ON public.oral_messages;
CREATE POLICY "oral_messages_delete_own" ON public.oral_messages
    FOR DELETE USING (auth.uid()::text = user_id::text);

SELECT 'oral_sessions DELETE RLS 策略添加成功' AS result;