import { EdgeTTS } from '@andresaya/edge-tts';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// 允许 CORS
const allowCors = (fn: Function) => async (req: VercelRequest, res: VercelResponse) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  return await fn(req, res);
};

const handler = async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      text,
      voice = 'en-US-EmmaMultilingualNeural',
      rate = '-8%',
      pitch = '+2Hz',
    } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log(`[TTS] Synthesizing: ${voice} - "${text.substring(0, 50)}..."`);

    // 使用 @andresaya/edge-tts 合成音频
    const tts = new EdgeTTS();

    // 合成音频
    await tts.synthesize(text, voice, {
      rate,
      pitch,
      volume: '+0%',
    });

    // 导出为原始音频 buffer
    const audioBuffer = await tts.toRaw();

    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(500).json({ error: 'No audio data generated' });
    }

    console.log(`[TTS] Generated ${audioBuffer.length} bytes of audio`);

    // 返回音频数据
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length.toString());
    return res.send(Buffer.from(audioBuffer));

  } catch (error) {
    console.error('[TTS] Error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default allowCors(handler);
