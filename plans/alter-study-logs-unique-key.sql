-- ============================================================
-- 修改 study_logs 表去重逻辑（按日期去重，不区分来源）
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================

-- 1. 删除旧的 RLS 策略
DROP POLICY IF EXISTS "study_logs_select_own" ON public.study_logs;
DROP POLICY IF EXISTS "study_logs_insert_own" ON public.study_logs;
DROP POLICY IF EXISTS "study_logs_update_own" ON public.study_logs;
DROP POLICY IF EXISTS "study_logs_delete_own" ON public.study_logs;

-- 2. 删除旧索引和约束
DROP INDEX IF EXISTS idx_study_logs_user_date;
DROP INDEX IF EXISTS idx_study_logs_user_source_date;
ALTER TABLE public.study_logs DROP CONSTRAINT IF EXISTS study_logs_user_id_study_date_source_key;

-- 3. 添加新的唯一约束（按日期去重，不区分来源）
ALTER TABLE public.study_logs ADD CONSTRAINT study_logs_user_id_study_date_key UNIQUE (user_id, study_date);

-- 4. 添加新索引
CREATE INDEX IF NOT EXISTS idx_study_logs_user_date
    ON public.study_logs (user_id, study_date DESC);

-- 5. 重新创建 RLS 策略
ALTER TABLE public.study_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "study_logs_select_own" ON public.study_logs
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "study_logs_insert_own" ON public.study_logs
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "study_logs_update_own" ON public.study_logs
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "study_logs_delete_own" ON public.study_logs
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');

-- 验证
SELECT 'study_logs 表修改成功' AS result;
