-- ============================================================
-- 勋章系统数据库表创建脚本
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================

-- user_achievements 表：记录用户已解锁的勋章
-- user_id 使用 TEXT 类型以支持已登录用户(UUID)和未登录用户('default_user')
CREATE TABLE IF NOT EXISTS public.user_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,             -- 支持 UUID 或 'default_user' 字符串
    badge_id TEXT NOT NULL,          -- 勋章唯一标识，如 'midnight_learner'
    unlocked_at TIMESTAMPTZ DEFAULT now(),  -- 解锁时间
    created_at TIMESTAMPTZ DEFAULT now(),

    -- 同一用户同一勋章只能解锁一次
    UNIQUE (user_id, badge_id)
);

-- 索引：按用户查询所有已解锁勋章
CREATE INDEX IF NOT EXISTS idx_user_achievements_user
    ON public.user_achievements (user_id, badge_id);

-- 行级安全策略（RLS）
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

-- 用户只能读写自己的勋章记录（支持已登录用户和未登录用户）
CREATE POLICY "user_achievements_select_own" ON public.user_achievements
    FOR SELECT USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_achievements_insert_own" ON public.user_achievements
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_achievements_update_own" ON public.user_achievements
    FOR UPDATE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
CREATE POLICY "user_achievements_delete_own" ON public.user_achievements
    FOR DELETE USING (auth.uid()::TEXT = user_id OR user_id = 'default_user');
