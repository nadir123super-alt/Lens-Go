
// @ts-nocheck - This is a Deno/Supabase Edge Function, not part of the frontend
import { EdgeTts } from './edgeTts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 音频输出格式常量
const OUTPUT_FORMAT = 'audio-24khz-96kbitrate-mono-mp3';

// 转换 Uint8Array 为 base64
function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = '';
  const len = arr.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

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
    const { text, voice, rate, pitch, ssml, language } = await req.json();

    if (!ssml && !text) {
      return new Response(JSON.stringify({ error: 'Text or SSML is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[TTS] Synthesizing with SSML: ${!!ssml} - "${(text || '').substring(0, 50)}..."`);

    const tts = new EdgeTts();

    // 使用 SSML 或构建默认 SSML
    let finalSsml = ssml;
    if (!finalSsml) {
      const isChinese = (voice || '').includes('zh-CN') || language === 'zh';
      const xmlLang = isChinese ? 'zh-CN' : 'en-US';
      finalSsml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${xmlLang}">
        <voice name="${voice || 'en-US-EmmaMultilingualNeural'}">
          <prosody rate="${rate || '-8%'}" pitch="${pitch || '+2Hz'}">
            ${text}
          </prosody>
        </voice>
      </speak>`;
    }

    console.log(`[TTS] Final SSML: ${finalSsml.substring(0, 200)}...`);

    // 合成音频
    const audioData = await tts.synthesizeSsml(finalSsml, OUTPUT_FORMAT);
    
    // 转换为 base64
    const audioBase64 = uint8ArrayToBase64(audioData);

    console.log(`[TTS] 生成音频成功: ${audioBase64.length} 字符`);

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
