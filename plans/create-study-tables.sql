-- ============================================================
-- 学习统计数据库表创建脚本
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================

-- 1. user_word_scores 表：记录每个单词的口语得分
--    用于统计"词汇量"（score >= 80 的单词数）
--    user_id 外键关联 auth.users(id)，ON DELETE CASCADE
CREATE TABLE IF NOT EXISTS public.user_word_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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


-- 2. study_logs 表：记录每次学习活动（按日期去重）
--    用于统计"学习天数"
--    user_id 外键关联 auth.users(id)，ON DELETE CASCADE
CREATE TABLE IF NOT EXISTS public.study_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    study_date DATE NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('camera', 'practice')),
    created_at TIMESTAMPTZ DEFAULT now(),

    -- 同一天同一来源只记录一次
    UNIQUE (user_id, study_date, source)
);

-- 索引：按用户查询学习天数
CREATE INDEX IF NOT EXISTS idx_study_logs_user_date
    ON public.study_logs (user_id, study_date DESC);

-- 3. 行级安全策略（RLS）
ALTER TABLE public.user_word_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_logs ENABLE ROW LEVEL SECURITY;

-- user_word_scores: 用户只能读写自己的数据
CREATE POLICY "user_word_scores_select_own" ON public.user_word_scores
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_word_scores_insert_own" ON public.user_word_scores
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_word_scores_update_own" ON public.user_word_scores
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "user_word_scores_delete_own" ON public.user_word_scores
    FOR DELETE USING (auth.uid() = user_id);

-- study_logs: 用户只能读写自己的学习记录
CREATE POLICY "study_logs_select_own" ON public.study_logs
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "study_logs_insert_own" ON public.study_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "study_logs_update_own" ON public.study_logs
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "study_logs_delete_own" ON public.study_logs
    FOR DELETE USING (auth.uid() = user_id);
