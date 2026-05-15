-- ============================================================
-- 生词本 & 练习分数 数据库表创建脚本
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================

-- 1. user_notebook 表：存储个人生词
--    user_id 外键关联 auth.users(id)，ON DELETE CASCADE
CREATE TABLE IF NOT EXISTS public.user_notebook (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    translation TEXT NOT NULL DEFAULT '',
    usage TEXT DEFAULT '',
    phrases JSONB DEFAULT '[]'::jsonb,
    image_path TEXT DEFAULT '',
    source TEXT NOT NULL DEFAULT 'search' CHECK (source IN ('camera', 'search')),
    mastery_score INTEGER DEFAULT NULL CHECK (mastery_score IS NULL OR (mastery_score >= 0 AND mastery_score <= 100)),
    sentence_mastery INTEGER DEFAULT NULL CHECK (sentence_mastery IS NULL OR (sentence_mastery >= 0 AND sentence_mastery <= 100)),
    sentence_practiced TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- 同一用户同一单词只保留一条记录（upsert 时覆盖）
    UNIQUE (user_id, word)
);

-- 索引：按用户查询生词
CREATE INDEX IF NOT EXISTS idx_user_notebook_user_id
    ON public.user_notebook (user_id, created_at DESC);

-- 索引：按单词搜索
CREATE INDEX IF NOT EXISTS idx_user_notebook_word
    ON public.user_notebook (user_id, word);


-- 2. user_scores 表：存储口语练习分数
--    user_id 外键关联 auth.users(id)，ON DELETE CASCADE
CREATE TABLE IF NOT EXISTS public.user_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    exercise_type TEXT NOT NULL CHECK (exercise_type IN ('word', 'sentence')),
    word TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 索引：按用户查询练习分数
CREATE INDEX IF NOT EXISTS idx_user_scores_user_id
    ON public.user_scores (user_id, created_at DESC);


-- 3. 自动更新 updated_at 的触发器（user_notebook）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_notebook_updated_at ON public.user_notebook;
CREATE TRIGGER trigger_user_notebook_updated_at
    BEFORE UPDATE ON public.user_notebook
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- 4. 行级安全策略（RLS）
ALTER TABLE public.user_notebook ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_scores ENABLE ROW LEVEL SECURITY;

-- user_notebook: 用户只能读写自己的数据
CREATE POLICY "Users can view their own notebook"
    ON public.user_notebook FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notebook"
    ON public.user_notebook FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notebook"
    ON public.user_notebook FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notebook"
    ON public.user_notebook FOR DELETE
    USING (auth.uid() = user_id);

-- user_scores: 用户只能读写自己的分数
CREATE POLICY "Users can view their own scores"
    ON public.user_scores FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scores"
    ON public.user_scores FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scores"
    ON public.user_scores FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scores"
    ON public.user_scores FOR DELETE
    USING (auth.uid() = user_id);
