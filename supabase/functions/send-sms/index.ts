// @ts-nocheck - This is a Deno/Supabase Edge Function, not part of the frontend
/**
 * send-sms — Supabase Edge Function
 *
 * 通过腾讯云 SMS 发送短信验证码
 *
 * 环境变量（在 Supabase 控制台设置）：
 * - TENCENT_SECRET_ID: 腾讯云 SecretId
 * - TENCENT_SECRET_KEY: 腾讯云 SecretKey
 * - SMS_SDK_APP_ID: 腾讯云短信应用 ID（如 1400xxxxxx）
 * - SMS_SIGN: 短信签名（如 "Lens Go"）
 * - SMS_TEMPLATE_ID: 验证码模板 ID
 *
 * 调用方式：
 *   POST /send-sms
 *   Body: { phone: "13800138000" }
 *
 * 返回：
 *   { success: true, message: "验证码已发送" }
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 腾讯云 SMS API 配置
const SMS_ENDPOINT = 'sms.tencentcloudapi.com';
const SMS_SERVICE = 'sms';
const SMS_VERSION = '2021-01-11';
const SMS_ACTION = 'SendSms';

/**
 * 将 Uint8Array 转为十六进制字符串
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 计算 SHA-256 哈希，返回十六进制字符串
 */
async function sha256hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * 计算 HMAC-SHA256，返回 Uint8Array
 */
async function hmacSha256(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return new Uint8Array(signature);
}

/**
 * 计算 HMAC-SHA256，返回十六进制字符串
 */
async function hmacSha256Hex(key: string | Uint8Array, data: string): Promise<string> {
  const sig = await hmacSha256(key, data);
  return bytesToHex(sig);
}

/**
 * 生成腾讯云 API 签名 V3 (TC3-HMAC-SHA256)
 * 参考：https://cloud.tencent.com/document/api/598/33151
 */
async function buildTencentCloudHeaders(
  secretId: string,
  secretKey: string,
  method: string,
  endpoint: string,
  service: string,
  action: string,
  version: string,
  region: string,
  payload: string,
  timestamp: number,
): Promise<Record<string, string>> {
  const date = new Date(timestamp * 1000)
    .toISOString()
    .replace(/[-:]/g, '')
    .split('.')[0] + 'Z';

  // 1. 构建 CanonicalRequest
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:application/json\nhost:${endpoint}\n`;
  const signedHeaders = 'content-type;host';
  const hashedPayload = await sha256hex(payload);

  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;

  // 2. 构建 StringToSign
  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = await sha256hex(canonicalRequest);
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

  // 3. 计算签名
  const secretDate = await hmacSha256(`TC3${secretKey}`, date);
  const secretService = await hmacSha256(secretDate, service);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = await hmacSha256Hex(secretSigning, stringToSign);

  return {
    'Content-Type': 'application/json',
    'Host': endpoint,
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': region,
    'Authorization': `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * 生成 6 位随机验证码
 */
function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * 调用腾讯云 SMS API 发送短信
 */
async function sendSmsCode(
  phone: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  const secretId = Deno.env.get('TENCENT_SECRET_ID');
  const secretKey = Deno.env.get('TENCENT_SECRET_KEY');
  const sdkAppId = Deno.env.get('SMS_SDK_APP_ID');
  const sign = Deno.env.get('SMS_SIGN');
  const templateId = Deno.env.get('SMS_TEMPLATE_ID');

  if (!secretId || !secretKey || !sdkAppId || !sign || !templateId) {
    console.error('[send-sms] 缺少 SMS 配置:', {
      hasSecretId: !!secretId,
      hasSecretKey: !!secretKey,
      hasSdkAppId: !!sdkAppId,
      hasSign: !!sign,
      hasTemplateId: !!templateId,
    });
    return { success: false, error: '短信服务未配置' };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: sdkAppId,
    SignName: sign,
    TemplateId: templateId,
    TemplateParamSet: [code, '5'], // 验证码，有效期5分钟
  });

  try {
    const headers = await buildTencentCloudHeaders(
      secretId,
      secretKey,
      'POST',
      SMS_ENDPOINT,
      SMS_SERVICE,
      SMS_ACTION,
      SMS_VERSION,
      'ap-guangzhou',
      payload,
      timestamp,
    );

    const response = await fetch(`https://${SMS_ENDPOINT}`, {
      method: 'POST',
      headers,
      body: payload,
    });

    const result = await response.json();
    console.log('[send-sms] 腾讯云响应:', JSON.stringify(result));

    if (result.Response?.Error) {
      return { success: false, error: result.Response.Error.Message };
    }

    return { success: true };
  } catch (err) {
    console.error('[send-sms] 发送失败:', err);
    return { success: false, error: '短信发送失败' };
  }
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
    const { phone } = await req.json();

    // 验证手机号格式
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      return new Response(JSON.stringify({ error: '手机号格式不正确' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 生成验证码
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5分钟有效期

    // 发送短信
    const smsResult = await sendSmsCode(phone, code);
    if (!smsResult.success) {
      return new Response(JSON.stringify({ error: smsResult.error || '短信发送失败' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 将验证码存储到数据库（使用 Supabase Admin Client）
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error: dbError } = await supabase
      .from('phone_verification_codes')
      .insert({
        phone,
        code,
        expires_at: expiresAt,
        used: false,
      });

    if (dbError) {
      console.error('[send-sms] 存储验证码失败:', dbError);
      // 短信已发送，但存储失败 - 仍返回成功，用户仍可输入验证码
      // 但后续验证会失败
    }

    console.log(`[send-sms] 验证码已发送到 ${phone}`);

    return new Response(JSON.stringify({
      success: true,
      message: '验证码已发送',
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });

  } catch (error) {
    console.error('[send-sms] Error:', error);
    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
