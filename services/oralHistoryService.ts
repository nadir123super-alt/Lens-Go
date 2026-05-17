import { supabase } from './supabaseClient';

export interface OralSession {
  id: string;
  user_id: string;
  duration_seconds: number;
  created_at: string;
  ended_at: string;
}

export interface OralMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'ai';
  content: string;
  created_at: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function saveOralSession(
  messages: ConversationMessage[],
  durationSeconds: number
): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[OralHistory] 用户未登录，无法保存对话记录');
      return null;
    }

    const { data: sessionData, error: sessionError } = await supabase
      .from('oral_sessions')
      .insert({
        user_id: user.id,
        duration_seconds: durationSeconds,
      })
      .select('id')
      .single();

    if (sessionError || !sessionData) {
      console.error('[OralHistory] 创建会话记录失败:', sessionError);
      return null;
    }

    const sessionId = sessionData.id;

    if (messages.length > 0) {
      const messagesToInsert = messages.map((msg) => ({
        session_id: sessionId,
        user_id: user.id,
        role: msg.role === 'assistant' ? 'ai' : 'user',
        content: msg.content,
      }));

      const { error: messagesError } = await supabase
        .from('oral_messages')
        .insert(messagesToInsert);

      if (messagesError) {
        console.error('[OralHistory] 插入消息失败:', messagesError);
      }
    }

    return sessionId;
  } catch (error) {
    console.error('[OralHistory] 保存会话异常:', error);
    return null;
  }
}

export async function getOralSessions(): Promise<OralSession[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[OralHistory] 用户未登录，无法获取会话列表');
      return [];
    }

    const { data, error } = await supabase
      .from('oral_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[OralHistory] 获取会话列表失败:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('[OralHistory] 获取会话列表异常:', error);
    return [];
  }
}

export async function getOralMessages(sessionId: string): Promise<OralMessage[]> {
  try {
    const { data, error } = await supabase
      .from('oral_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[OralHistory] 获取消息失败:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('[OralHistory] 获取消息异常:', error);
    return [];
  }
}