// @ts-nocheck - This is a Deno/Supabase Edge Function, not part of the frontend
import { EdgeTTS } from 'npm:@andresaya/edge-tts@1.6.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 音频输出格式常量
const OUTPUT_FORMAT = 'audio-24khz-96kbitrate-mono-mp3';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { text, voice, rate, pitch } = await req.json();

    if (!text) {
      return new Response(JSON.stringify({ error: 'Text is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[TTS] Synthesizing: ${voice || 'default'} - "${text.substring(0, 50)}..."`);

    const tts = new EdgeTTS();

    // 合成音频，明确指定输出格式
    await tts.synthesize(text, voice || 'en-US-EmmaMultilingualNeural', {
      rate: rate || '-8%',
      pitch: pitch || '+2Hz',
      volume: '+0%',
      outputFormat: OUTPUT_FORMAT,
    });

    // 优先使用 toBase64() 直接获取 base64 字符串
    let audioBase64: string | null = null;
    let methodUsed = '';
    
    // 方法 1: 优先使用 toBase64()
    try {
      if (typeof tts.toBase64 === 'function') {
        audioBase64 = await tts.toBase64();
        methodUsed = 'toBase64()';
        console.log(`[TTS] ${methodUsed} 成功: ${audioBase64?.length || 0} 字符`);
      }
    } catch (e) {
      console.warn(`[TTS] ${methodUsed} 失败:`, e);
    }

    // 方法 2: 如果 toBase64() 失败，使用 toRaw() 然后编码
    if (!audioBase64) {
      try {
        if (typeof tts.toRaw === 'function') {
          const audioBuffer = await tts.toRaw();
          // 转换为 base64
          let binary = '';
          const bytes = new Uint8Array(audioBuffer);
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          audioBase64 = btoa(binary);
          methodUsed = 'toRaw() + btoa()';
          console.log(`[TTS] ${methodUsed} 成功: ${audioBase64.length} 字符`);
        }
      } catch (e) {
        console.warn(`[TTS] ${methodUsed} 失败:`, e);
      }
    }

    // 方法 3: 如果以上都失败，尝试直接访问 audio_stream
    if (!audioBase64) {
      try {
        const ttsAny = tts as any;
        if (ttsAny.audio_stream && Array.isArray(ttsAny.audio_stream)) {
          const chunks = ttsAny.audio_stream as Uint8Array[];
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const audioBuffer = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            audioBuffer.set(chunk, offset);
            offset += chunk.length;
          }
          // 转换为 base64
          let binary = '';
          for (let i = 0; i < audioBuffer.byteLength; i++) {
            binary += String.fromCharCode(audioBuffer[i]);
          }
          audioBase64 = btoa(binary);
          methodUsed = 'audio_stream + btoa()';
          console.log(`[TTS] ${methodUsed} 成功: ${audioBase64.length} 字符`);
        }
      } catch (e) {
        console.warn('[TTS] audio_stream 失败:', e);
      }
    }

    // 最终检查
    if (!audioBase64 || audioBase64.length === 0) {
      console.error('[TTS] 所有获取音频数据的方法都失败了');
      console.log('[TTS] tts 对象方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(tts)));
      
      return new Response(JSON.stringify({ 
        error: 'No audio data generated',
        debug: '请检查 Edge Function 日志以获取更多信息'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[TTS] 生成音频成功: ${audioBase64.length} 字符 (使用 ${methodUsed})`);

    // 返回 JSON 格式的响应，包含 base64 音频数据
    return new Response(JSON.stringify({
      success: true,
      audioBase64: audioBase64,
      format: 'audio/mpeg'
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });

  } catch (error) {
    console.error('[TTS] Error:', error);
    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
