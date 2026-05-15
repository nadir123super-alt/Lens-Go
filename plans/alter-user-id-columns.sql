-- ============================================================
-- 修改表结构以支持未登录用户（'default_user' 字符串）
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================

-- ============================================================
-- 1. user_achievements 表
-- ============================================================
DROP POLICY IF EXISTS "user_achievements_select_own" ON public.user_achievements;
DROP POLICY IF EXISTS "user_achievements_insert_own" ON public.user_achievements;
DROP POLICY IF EXISTS "user_achievements_update_own" ON public.user_achievements;
DROP POLICY IF EXISTS "user_achievements_delete_own" ON public.user_achievements;
ALTER TABLE public.user_achievements ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE public.user_achievements ALTER COLUMN user_id DROP NOT NULL;
CREATE POLICY "user_achievements_select_own" ON public.user_achievements
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_achievements_insert_own" ON public.user_achievements
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_achievements_update_own" ON public.user_achievements
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_achievements_delete_own" ON public.user_achievements
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');

-- ============================================================
-- 2. practice_logs 表
-- ============================================================
DROP POLICY IF EXISTS "practice_logs_select_own" ON public.practice_logs;
DROP POLICY IF EXISTS "practice_logs_insert_own" ON public.practice_logs;
DROP POLICY IF EXISTS "practice_logs_update_own" ON public.practice_logs;
DROP POLICY IF EXISTS "practice_logs_delete_own" ON public.practice_logs;
ALTER TABLE public.practice_logs ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE public.practice_logs ALTER COLUMN user_id DROP NOT NULL;
CREATE POLICY "practice_logs_select_own" ON public.practice_logs
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "practice_logs_insert_own" ON public.practice_logs
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "practice_logs_update_own" ON public.practice_logs
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "practice_logs_delete_own" ON public.practice_logs
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');

-- ============================================================
-- 3. user_word_scores 表
-- ============================================================
DROP POLICY IF EXISTS "user_word_scores_select_own" ON public.user_word_scores;
DROP POLICY IF EXISTS "user_word_scores_insert_own" ON public.user_word_scores;
DROP POLICY IF EXISTS "user_word_scores_update_own" ON public.user_word_scores;
DROP POLICY IF EXISTS "user_word_scores_delete_own" ON public.user_word_scores;
ALTER TABLE public.user_word_scores ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE public.user_word_scores ALTER COLUMN user_id DROP NOT NULL;
CREATE POLICY "user_word_scores_select_own" ON public.user_word_scores
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_word_scores_insert_own" ON public.user_word_scores
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_word_scores_update_own" ON public.user_word_scores
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_word_scores_delete_own" ON public.user_word_scores
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');

-- ============================================================
-- 4. study_logs 表
-- ============================================================
DROP POLICY IF EXISTS "study_logs_select_own" ON public.study_logs;
DROP POLICY IF EXISTS "study_logs_insert_own" ON public.study_logs;
DROP POLICY IF EXISTS "study_logs_update_own" ON public.study_logs;
DROP POLICY IF EXISTS "study_logs_delete_own" ON public.study_logs;
ALTER TABLE public.study_logs ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE public.study_logs ALTER COLUMN user_id DROP NOT NULL;
CREATE POLICY "study_logs_select_own" ON public.study_logs
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "study_logs_insert_own" ON public.study_logs
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "study_logs_update_own" ON public.study_logs
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "study_logs_delete_own" ON public.study_logs
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');

-- ============================================================
-- 5. audio_click_counts 表
-- ============================================================
DROP POLICY IF EXISTS "audio_click_counts_select_own" ON public.audio_click_counts;
DROP POLICY IF EXISTS "audio_click_counts_insert_own" ON public.audio_click_counts;
DROP POLICY IF EXISTS "audio_click_counts_update_own" ON public.audio_click_counts;
DROP POLICY IF EXISTS "audio_click_counts_delete_own" ON public.audio_click_counts;
ALTER TABLE public.audio_click_counts ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE public.audio_click_counts ALTER COLUMN user_id DROP NOT NULL;
CREATE POLICY "audio_click_counts_select_own" ON public.audio_click_counts
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "audio_click_counts_insert_own" ON public.audio_click_counts
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "audio_click_counts_update_own" ON public.audio_click_counts
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "audio_click_counts_delete_own" ON public.audio_click_counts
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');

-- 验证
SELECT '所有表结构修改成功' AS result;
