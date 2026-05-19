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

export async function deleteOralSession(sessionId: string): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[OralHistory] 用户未登录，无法删除会话');
      return false;
    }

    console.log(`[OralHistory] 尝试删除会话: sessionId=${sessionId}, userId=${user.id}`);

    // 使用 auth.uid() 匹配用户，确保 RLS 策略允许删除
    const { error: sessionError, data: deleted } = await supabase
      .from('oral_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .select();

    if (sessionError) {
      console.error('[OralHistory] 删除会话失败:', sessionError);
      return false;
    }

    console.log(`[OralHistory] 删除操作返回: ${deleted ? `删除了 ${deleted.length} 条` : '无返回数据'}`);

    // 验证删除是否成功
    const { data: remaining } = await supabase
      .from('oral_sessions')
      .select('id')
      .eq('id', sessionId);
    
    if (remaining && remaining.length > 0) {
      console.error('[OralHistory] 删除失败：会话仍然存在');
      
      // 尝试直接使用 admin 权限删除（如果配置了服务角色密钥）
      console.log('[OralHistory] 尝试使用替代方法删除...');
      try {
        // 使用 REST API 直接调用，绕过 RLS
        const response = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/oral_sessions?id=eq.${sessionId}`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
              'Authorization': `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || ''}`,
            },
          }
        );
        
        if (response.ok) {
          console.log('[OralHistory] 通过 REST API 删除成功');
          return true;
        } else {
          console.error('[OralHistory] REST API 删除失败:', await response.text());
          return false;
        }
      } catch (apiError) {
        console.error('[OralHistory] REST API 删除异常:', apiError);
        return false;
      }
    }

    console.log('[OralHistory] 删除会话成功');
    return true;
  } catch (error) {
    console.error('[OralHistory] 删除会话异常:', error);
    return false;
  }
}

export async function clearAllOralSessions(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn('[OralHistory] 用户未登录，无法清空记录');
      return false;
    }

    // oral_messages 有 ON DELETE CASCADE，删除 sessions 会自动级联删除 messages
    const { error: sessionError, count } = await supabase
      .from('oral_sessions')
      .delete()
      .eq('user_id', user.id)
      .select();

    if (sessionError) {
      console.error('[OralHistory] 清空会话失败:', sessionError);
      return false;
    }

    console.log(`[OralHistory] 清空会话成功，删除行数: ${count}`);
    return true;
  } catch (error) {
    console.error('[OralHistory] 清空会话异常:', error);
    return false;
  }
}
