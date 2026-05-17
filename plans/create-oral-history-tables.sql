-- ============================================================
-- AI 口语对话历史记录表
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 1. oral_sessions 表：存储每场通话的基本信息
CREATE TABLE IF NOT EXISTS public.oral_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    duration_seconds INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    ended_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oral_sessions_user_created
    ON public.oral_sessions (user_id, created_at DESC);

ALTER TABLE public.oral_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oral_sessions_select_own" ON public.oral_sessions;
CREATE POLICY "oral_sessions_select_own" ON public.oral_sessions
    FOR SELECT USING (auth.uid()::TEXT = user_id);

DROP POLICY IF EXISTS "oral_sessions_insert_own" ON public.oral_sessions;
CREATE POLICY "oral_sessions_insert_own" ON public.oral_sessions
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id);


-- 2. oral_messages 表：存储每场通话的详细消息
CREATE TABLE IF NOT EXISTS public.oral_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.oral_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'ai')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oral_messages_session
    ON public.oral_messages (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_oral_messages_user
    ON public.oral_messages (user_id, created_at DESC);

ALTER TABLE public.oral_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oral_messages_select_own" ON public.oral_messages;
CREATE POLICY "oral_messages_select_own" ON public.oral_messages
    FOR SELECT USING (auth.uid()::TEXT = user_id);

DROP POLICY IF EXISTS "oral_messages_insert_own" ON public.oral_messages;
CREATE POLICY "oral_messages_insert_own" ON public.oral_messages
    FOR INSERT WITH CHECK (auth.uid()::TEXT = user_id);

SELECT 'AI 对话历史表创建成功' AS result;