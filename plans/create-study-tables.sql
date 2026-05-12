-- ============================================================
-- 学习统计数据库表创建脚本
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================

-- 1. user_word_scores 表：记录每个单词的口语得分
--    用于统计"词汇量"（score >= 80 的单词数）
CREATE TABLE IF NOT EXISTS public.user_word_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL DEFAULT 'default_user',
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
CREATE TABLE IF NOT EXISTS public.study_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL DEFAULT 'default_user',
    study_date DATE NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('camera', 'practice')),
    created_at TIMESTAMPTZ DEFAULT now(),

    -- 同一天同一来源只记录一次
    UNIQUE (user_id, study_date, source)
);

-- 索引：按用户查询学习天数
CREATE INDEX IF NOT EXISTS idx_study_logs_user_date
    ON public.study_logs (user_id, study_date DESC);

-- 3. 启用行级安全（可选，后续对接用户系统后可启用）
-- ALTER TABLE public.user_word_scores ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.study_logs ENABLE ROW LEVEL SECURITY;

-- 4. 允许匿名用户读写（当前使用固定 user_id，后续可改为用户认证）
--    如果 Supabase 项目启用了 RLS，需要添加以下策略：
-- CREATE POLICY "Allow anonymous read user_word_scores"
--     ON public.user_word_scores FOR SELECT
--     USING (true);
-- CREATE POLICY "Allow anonymous insert user_word_scores"
--     ON public.user_word_scores FOR INSERT
--     WITH CHECK (true);
-- CREATE POLICY "Allow anonymous update user_word_scores"
--     ON public.user_word_scores FOR UPDATE
--     USING (true);
-- CREATE POLICY "Allow anonymous read study_logs"
--     ON public.study_logs FOR SELECT
--     USING (true);
-- CREATE POLICY "Allow anonymous insert study_logs"
--     ON public.study_logs FOR INSERT
--     WITH CHECK (true);
