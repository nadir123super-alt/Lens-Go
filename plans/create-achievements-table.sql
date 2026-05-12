-- ============================================================
-- 勋章系统数据库表创建脚本
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================

-- user_achievements 表：记录用户已解锁的勋章
CREATE TABLE IF NOT EXISTS public.user_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL DEFAULT 'default_user',
    badge_id TEXT NOT NULL,          -- 勋章唯一标识，如 'midnight_learner'
    unlocked_at TIMESTAMPTZ DEFAULT now(),  -- 解锁时间
    created_at TIMESTAMPTZ DEFAULT now(),

    -- 同一用户同一勋章只能解锁一次
    UNIQUE (user_id, badge_id)
);

-- 索引：按用户查询所有已解锁勋章
CREATE INDEX IF NOT EXISTS idx_user_achievements_user
    ON public.user_achievements (user_id, badge_id);

-- 允许匿名用户读写（当前使用固定 user_id）
-- 如果 Supabase 项目启用了 RLS，需要取消注释以下策略：
-- ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow anonymous read user_achievements"
--     ON public.user_achievements FOR SELECT
--     USING (true);
-- CREATE POLICY "Allow anonymous insert user_achievements"
--     ON public.user_achievements FOR INSERT
--     WITH CHECK (true);
