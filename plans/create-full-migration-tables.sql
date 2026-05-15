-- ============================================================
-- 全量业务数据迁移 — 建表脚本
-- 说明：在 Supabase SQL Editor 中执行此脚本
-- 功能：创建 user_settings、learning_progress、ai_chat_history 表
--       全部设置 user_id 级联删除 (ON DELETE CASCADE)
--       并配置行级安全策略 (RLS)
-- ============================================================

-- ============================================================
-- 1. user_settings — 用户设置表
-- 字段说明：
--   - user_id: 用户 ID（主键，外键 -> auth.users）
--   - daily_target: 每日学习目标（默认 5）
--   - voice_preference: 语音偏好（默认 'default'）
--   - theme_mode: 主题模式（默认 'dark'）
--   - speech_rate: 语速（0.5 ~ 2.0，默认 1.0）
--   - reminder_enabled: 每日提醒开关（默认 false）
--   - reminder_hour: 提醒小时（0-23，默认 20）
--   - reminder_minute: 提醒分钟（0-59，默认 0）
--   - created_at / updated_at: 时间戳
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    daily_target INTEGER NOT NULL DEFAULT 5,
    voice_preference TEXT NOT NULL DEFAULT 'default',
    theme_mode TEXT NOT NULL DEFAULT 'dark',
    speech_rate DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    reminder_enabled BOOLEAN NOT NULL DEFAULT false,
    reminder_hour INTEGER NOT NULL DEFAULT 20,
    reminder_minute INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_settings_pkey PRIMARY KEY (user_id),
    CONSTRAINT user_settings_speech_rate_check CHECK (speech_rate >= 0.5 AND speech_rate <= 2.0),
    CONSTRAINT user_settings_reminder_hour_check CHECK (reminder_hour >= 0 AND reminder_hour <= 23),
    CONSTRAINT user_settings_reminder_minute_check CHECK (reminder_minute >= 0 AND reminder_minute <= 59)
);

-- 自动更新 updated_at 的触发器
CREATE OR REPLACE FUNCTION public.update_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_user_settings_updated_at ON public.user_settings;
CREATE TRIGGER trigger_update_user_settings_updated_at
    BEFORE UPDATE ON public.user_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_user_settings_updated_at();

-- RLS 策略
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- 用户只能读写自己的设置
CREATE POLICY "user_settings_select_own" ON public.user_settings
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_settings_insert_own" ON public.user_settings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_settings_update_own" ON public.user_settings
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "user_settings_delete_own" ON public.user_settings
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 2. learning_progress — 学习进度表
-- 字段说明：
--   - id: 主键 UUID
--   - user_id: 用户 ID（外键 -> auth.users）
--   - stage_id: 阶段 ID（如 'stage_1', 'stage_2'）
--   - status: 完成状态（'completed' / 'ongoing'）
--   - last_accessed: 最后访问时间
--   - created_at: 创建时间
-- ============================================================
CREATE TABLE IF NOT EXISTS public.learning_progress (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stage_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ongoing',
    last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT learning_progress_pkey PRIMARY KEY (id),
    CONSTRAINT learning_progress_status_check CHECK (status IN ('completed', 'ongoing')),
    CONSTRAINT learning_progress_user_stage_unique UNIQUE (user_id, stage_id)
);

-- RLS 策略
ALTER TABLE public.learning_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "learning_progress_select_own" ON public.learning_progress
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "learning_progress_insert_own" ON public.learning_progress
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "learning_progress_update_own" ON public.learning_progress
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "learning_progress_delete_own" ON public.learning_progress
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 3. ai_chat_history — AI 对话历史表
-- 字段说明：
--   - id: 主键 UUID
--   - user_id: 用户 ID（外键 -> auth.users）
--   - role: 角色（'user' / 'ai'）
--   - content: 对话内容
--   - created_at: 创建时间
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_chat_history (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ai_chat_history_pkey PRIMARY KEY (id),
    CONSTRAINT ai_chat_history_role_check CHECK (role IN ('user', 'ai'))
);

-- RLS 策略
ALTER TABLE public.ai_chat_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_chat_history_select_own" ON public.ai_chat_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "ai_chat_history_insert_own" ON public.ai_chat_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "ai_chat_history_delete_own" ON public.ai_chat_history
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 4. 索引优化
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_learning_progress_user_id ON public.learning_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_progress_last_accessed ON public.learning_progress(last_accessed DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_history_user_id ON public.ai_chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_history_created_at ON public.ai_chat_history(created_at DESC);
