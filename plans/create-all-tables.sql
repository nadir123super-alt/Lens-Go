-- ============================================================
-- 全量建表脚本 — 在 Supabase SQL Editor 中一次性执行
-- 包含：user_word_scores, study_logs, practice_logs, user_achievements
-- 以及所有 RLS 策略
-- ============================================================

-- 先删除可能存在的旧表（避免列名冲突），再重建
DROP TABLE IF EXISTS public.user_achievements CASCADE;
DROP TABLE IF EXISTS public.practice_logs CASCADE;
DROP TABLE IF EXISTS public.study_logs CASCADE;
DROP TABLE IF EXISTS public.user_word_scores CASCADE;

-- ============================================================
-- 1. user_word_scores 表：记录每个单词的口语得分
-- ============================================================
CREATE TABLE public.user_word_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,             -- 支持 UUID 或 'default_user' 字符串
    word TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    source TEXT NOT NULL CHECK (source IN ('camera', 'practice')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- 同一用户同一单词只保留一条记录（upsert 时覆盖）
    UNIQUE (user_id, word)
);

-- 索引：按用户查询已掌握词汇（score >= 80）
CREATE INDEX IF NOT EXISTS idx_user_word_scores_mastered
    ON public.user_word_scores (user_id, score DESC);

-- 自动更新 updated_at 的触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_word_scores_updated_at ON public.user_word_scores;
CREATE TRIGGER trigger_user_word_scores_updated_at
    BEFORE UPDATE ON public.user_word_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.user_word_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_word_scores_select_own" ON public.user_word_scores
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_word_scores_insert_own" ON public.user_word_scores
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_word_scores_update_own" ON public.user_word_scores
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_word_scores_delete_own" ON public.user_word_scores
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');


-- ============================================================
-- 2. study_logs 表：记录学习日期（按日期去重，不区分来源）
-- ============================================================
CREATE TABLE public.study_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,             -- 支持 UUID 或 'default_user' 字符串
    study_date DATE NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('camera', 'practice')),
    created_at TIMESTAMPTZ DEFAULT now(),

    -- 同一天只记录一次（不区分来源）
    UNIQUE (user_id, study_date)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_study_logs_user_date
    ON public.study_logs (user_id, study_date DESC);

-- RLS
ALTER TABLE public.study_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "study_logs_select_own" ON public.study_logs
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "study_logs_insert_own" ON public.study_logs
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "study_logs_update_own" ON public.study_logs
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "study_logs_delete_own" ON public.study_logs
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');


-- ============================================================
-- 3. practice_logs 表：记录每次口语练习（用于成就系统检测）
-- ============================================================
CREATE TABLE public.practice_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,             -- 支持 UUID 或 'default_user' 字符串
    oral_score INTEGER NOT NULL CHECK (oral_score >= 0 AND oral_score <= 100),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引：按用户查询最近练习记录
CREATE INDEX IF NOT EXISTS idx_practice_logs_user
    ON public.practice_logs (user_id, created_at DESC);

-- RLS
ALTER TABLE public.practice_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "practice_logs_select_own" ON public.practice_logs
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "practice_logs_insert_own" ON public.practice_logs
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "practice_logs_update_own" ON public.practice_logs
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "practice_logs_delete_own" ON public.practice_logs
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');


-- ============================================================
-- 4. user_achievements 表：记录用户已解锁的勋章
-- ============================================================
CREATE TABLE public.user_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,             -- 支持 UUID 或 'default_user' 字符串
    badge_id TEXT NOT NULL,          -- 勋章唯一标识，如 'midnight_learner'
    unlocked_at TIMESTAMPTZ DEFAULT now(),  -- 解锁时间
    created_at TIMESTAMPTZ DEFAULT now(),

    -- 同一用户同一勋章只能解锁一次
    UNIQUE (user_id, badge_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_user_achievements_user
    ON public.user_achievements (user_id, badge_id);

-- RLS
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_achievements_select_own" ON public.user_achievements
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_achievements_insert_own" ON public.user_achievements
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_achievements_update_own" ON public.user_achievements
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_achievements_delete_own" ON public.user_achievements
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');


-- ============================================================
-- 5. audio_click_counts 表：记录发音点击统计
-- ============================================================
CREATE TABLE public.audio_click_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,             -- 支持 UUID 或 'default_user' 字符串
    total_clicks INTEGER NOT NULL DEFAULT 0,
    word_clicks JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- 唯一约束：每个用户只有一条记录（用于 upsert）
    UNIQUE (user_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_audio_click_counts_user
    ON public.audio_click_counts (user_id);

-- RLS
ALTER TABLE public.audio_click_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audio_click_counts_select_own" ON public.audio_click_counts
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "audio_click_counts_insert_own" ON public.audio_click_counts
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "audio_click_counts_update_own" ON public.audio_click_counts
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "audio_click_counts_delete_own" ON public.audio_click_counts
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');


-- 验证
SELECT '所有表创建成功' AS result;
