// ============================================================
//  Cloudflare Workers 统一代理（ES Module 语法）
//
//  ⚠️ 安全约定：任何密钥都不允许写在本文件或仓库里的任何地方，
//  一律存放在 Cloudflare Worker 的环境变量（加密 Secrets）中。
//
//  需要在 Cloudflare 控制台（或 wrangler secret put）配置：
//    AI_PROVIDER  快速切换：deepseek | agnes | glm（默认 deepseek）
//    AI_API_KEY   AI 服务商 API Key（必须是重发后的新 key，旧的已随 git 历史泄露）
//    AI_API_URL   可选，覆盖预设上游地址
//    AI_MODEL     可选，覆盖预设模型名（如 deepseek-flash / deepseek-chat）
//    UUHB_API_KEY 运势/答案之书等 uuhb.cn 系列的 ak_xxxx
//    LOTTERY_TOKEN 彩票接口 token（可选，不配则 /lottery 返回 503）
//
//  路由一览：
//    POST /chat            统一 AI 对话代理（支持流式透传），前端页面统一走这里
//    POST /morning         早安文案（兼容旧路由，等同 /chat 的非流式封装）
//    GET  /uuhb/<service>  uuhb.cn 系列代理（fortune / answerbook），apiKey 由服务端注入
//    GET  /lottery         彩票代理
//    GET  /wallpaper       壁纸代理
//    POST /tts             TTS 语音合成代理
//    GET  /heartWords      首页暖心话（Hitokoto 一言 + 时段问候）
// ============================================================

const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-TS, X-SIG',
};

// 允许的前端来源：线上站点 + 本地调试（localhost / 127.0.0.1 任意端口）。
// 无 Origin 头的请求（curl、file:// 等）放行——这只是防盗刷的软校验，
// 真正的额度保护靠的是 key 只存在于 Worker 端、且可以随时在控制台吊销。
const ALLOWED_ORIGINS = ['https://wnzc.github.io'];
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function isAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin || origin === 'null') return true;
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN_RE.test(origin);
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allow = origin && origin !== 'null' && (ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN_RE.test(origin))
    ? origin
    : ALLOWED_ORIGINS[0];
  return { ...CORS_BASE, 'Access-Control-Allow-Origin': allow };
}

function json(data, status, request, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json', ...(extraHeaders || {}) },
  });
}

// ---------- 防盗刷：IP 限流 + 时间戳签名 ----------
// 与 src/ai-config.js 的 AI_SIGN.secret / server/app.py 对齐。
// 注：isolate 级内存 Map 是尽力而为（冷启动会清零），挡不住分布式刷，但能拦住裸脚本。
const DEFAULT_SIGN_SECRET = 'wnzc-soft-sign-2026';
const SIGN_WINDOW_MS = 300000;
const RATE_LIMIT_PER_MIN = 20;
const RATE_WINDOW_MS = 60000;
const rateHits = new Map();

function clientIp(request) {
  const xff = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

function checkRateLimit(request) {
  const ip = clientIp(request);
  const now = Date.now();
  let hits = rateHits.get(ip) || [];
  hits = hits.filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_PER_MIN) {
    const retryAfter = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000));
    rateHits.set(ip, hits);
    return { ok: false, retryAfter };
  }
  hits.push(now);
  rateHits.set(ip, hits);
  if (rateHits.size > 5000) {
    for (const [key, list] of rateHits) {
      const kept = list.filter((t) => now - t < RATE_WINDOW_MS);
      if (kept.length) rateHits.set(key, kept);
      else rateHits.delete(key);
    }
  }
  return { ok: true };
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifySignature(request, env) {
  const secret = env.SIGN_SECRET || DEFAULT_SIGN_SECRET;
  if (!secret) return { ok: true };
  const ts = request.headers.get('X-TS');
  const sig = request.headers.get('X-SIG');
  if (!ts || !sig) return { ok: false, error: '缺少签名头 X-TS / X-SIG' };
  const tsMs = Number(ts);
  if (!Number.isFinite(tsMs)) return { ok: false, error: '签名时间戳无效' };
  if (Math.abs(Date.now() - tsMs) > SIGN_WINDOW_MS) return { ok: false, error: '签名已过期' };
  const expected = await hmacSha256Hex(secret, ts);
  if (expected !== String(sig).toLowerCase()) return { ok: false, error: '签名校验失败' };
  return { ok: true };
}

async function guardProtected(request, env) {
  const rate = checkRateLimit(request);
  if (!rate.ok) {
    return json({ error: '请求过于频繁，请稍后再试' }, 429, request, { 'Retry-After': String(rate.retryAfter) });
  }
  const signed = await verifySignature(request, env);
  if (!signed.ok) {
    return json({ error: signed.error || '签名校验失败' }, 401, request);
  }
  return null;
}

// 把前端统一的 thinking 参数映射为各服务商实际字段。
// 不传 → 默认关闭思考。Agnes: chat_template_kwargs；DeepSeek: thinking.type
function normalizeThinking(thinking, model) {
  let enabled = false;
  if (typeof thinking === 'boolean') {
    enabled = thinking;
  } else if (thinking && typeof thinking === 'object') {
    if (thinking.type === 'enabled') enabled = true;
    else if (thinking.type === 'disabled') enabled = false;
    else if ('enable_thinking' in thinking) enabled = !!thinking.enable_thinking;
    else return { thinking };
  } else if (thinking !== undefined && thinking !== null) {
    enabled = false;
  }
  const m = String(model || '').toLowerCase();
  if (m.includes('agnes')) return { chat_template_kwargs: { enable_thinking: enabled } };
  if (m.includes('deepseek')) return { thinking: { type: enabled ? 'enabled' : 'disabled' } };
  return {};
}

function requireEnv(env, names, request) {
  for (const name of names) {
    if (!env[name]) {
      return json({ error: `服务端未配置环境变量 ${name}` }, 500, request);
    }
  }
  return null;
}

// ============================================================
//  AI 通道配置（写在代码里；Key 只放 Secrets）
//  切换模型改 ACTIVE_PROVIDER 后部署即可，不用改环境变量。
// ============================================================

// ★★★ 只需要改这一行 ★★★
const ACTIVE_PROVIDER = 'deepseek';

const AI_PROVIDERS = {
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-flash',
  },
  agnes: {
    url: 'https://api.agnes-ai.cn/v1/chat/completions',
    model: 'agnes-3.0-flash',
  },
  glm: {
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4.7-flash',
  },
};

function loadApiKeys(env) {
  const keys = {};
  const raw = String(env.AI_API_KEYS || '').trim();
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const [k, v] of Object.entries(data)) {
          if (v) keys[String(k).trim().toLowerCase()] = String(v).trim();
        }
      }
    } catch (e) {
      console.warn('AI_API_KEYS 不是合法 JSON，已忽略');
    }
  }
  for (const name of Object.keys(AI_PROVIDERS)) {
    const val = String(env[name.toUpperCase() + '_API_KEY'] || '').trim();
    if (val) keys[name] = val;
  }
  const legacy = String(env.AI_API_KEY || '').trim();
  if (legacy && !keys[ACTIVE_PROVIDER]) keys[ACTIVE_PROVIDER] = legacy;
  return keys;
}

function resolveAiTarget(env) {
  const name = AI_PROVIDERS[ACTIVE_PROVIDER] ? ACTIVE_PROVIDER : 'deepseek';
  const preset = AI_PROVIDERS[name];
  const keys = loadApiKeys(env);
  return {
    provider: name,
    url: preset.url,
    model: preset.model,
    apiKey: keys[name] || '',
  };
}

// ==================== 统一 AI 对话代理 ====================
async function handleChat(request, env, { forceNonStream = false } = {}) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: '请求体不是合法 JSON' }, 400, request);
  }

  // 通道/模型/Key 全部服务端决定；忽略 body.model / body.provider
  const ai = resolveAiTarget(env);
  if (!ai.apiKey) {
    return json(
      { error: `服务端未配置 ${ai.provider} 的 API Key（请设置 AI_PROVIDER_CATALOG 或 ${ai.provider.toUpperCase()}_API_KEY）` },
      500,
      request,
    );
  }

  const payload = {
    model: ai.model,
    messages: Array.isArray(body.messages) ? body.messages : [],
    stream: forceNonStream ? false : body.stream === true,
  };
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.max_tokens !== undefined) payload.max_tokens = Math.min(Number(body.max_tokens) || 0, 65536) || undefined;
  Object.assign(payload, normalizeThinking(body.thinking, ai.model));

  const upstream = await fetch(ai.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ai.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  // 流式响应直接把字节流原样透传给前端，非流式则透传 JSON
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
    },
  });
}

// ==================== uuhb.cn 系列代理 ====================
const UUHB_SERVICES = ['fortune', 'answerbook'];

async function handleUuhb(request, env, service) {
  const missing = requireEnv(env, ['UUHB_API_KEY'], request);
  if (missing) return missing;
  if (!UUHB_SERVICES.includes(service)) {
    return json({ error: `不支持的服务: ${service}` }, 404, request);
  }

  const target = new URL(`https://v1.uuhb.cn/v1/${service}`);
  target.searchParams.set('apiKey', env.UUHB_API_KEY); // apiKey 由服务端注入
  const url = new URL(request.url);
  url.searchParams.forEach((value, key) => {
    if (key !== 'apiKey') target.searchParams.set(key, value);
  });

  const upstream = await fetch(target.toString());
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
    },
  });
}

// ==================== 首页暖心话 ====================
// 原实现代理的 apis.uctb.cn 已停摆（域名不再解析），改用 Hitokoto 一言作为句子来源。
// 返回结构保持前端兼容：{ code: 1, msg: 时段问候, nxyj: 一言句子 }
function greetingByHour(hour) {
  if (hour < 5) return '夜深了，注意休息';
  if (hour < 9) return '早上好，新的一天加油';
  if (hour < 12) return '上午好，元气满满';
  if (hour < 14) return '中午好，记得吃午饭';
  if (hour < 18) return '下午好，劳逸结合';
  return '晚上好，今天辛苦了';
}

async function handleHeartWords(request) {
  let sentence = '';
  let from = '';
  try {
    const resp = await fetch('https://v1.hitokoto.cn/?c=d&c=e&c=i', {
      headers: { 'User-Agent': 'wnzc-worker' },
    });
    if (resp.ok) {
      const data = await resp.json();
      sentence = data.hitokoto || '';
      from = data.from || '';
    }
  } catch (e) {
    // 上游失败时降级为纯问候语，前端还有 localStorage 缓存兜底
  }
  const greeting = greetingByHour((new Date().getUTCHours() + 8) % 24); // 东八区
  const nxyj = sentence ? (from ? `${sentence} ——「${from}」` : sentence) : '愿你在平凡的日子里，也能闪闪发光。';
  return json({ code: 1, msg: greeting, nxyj }, 200, request);
}

// ==================== 入口 ====================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) });
    }

    try {
      if (url.pathname === '/chat') {
        if (!isAllowedOrigin(request)) {
          return json({ error: 'Origin not allowed' }, 403, request);
        }
        const blockedChat = await guardProtected(request, env);
        if (blockedChat) return blockedChat;
        return await handleChat(request, env);
      }

      if (url.pathname === '/morning') {
        if (!isAllowedOrigin(request)) {
          return json({ error: 'Origin not allowed' }, 403, request);
        }
        const blockedMorning = await guardProtected(request, env);
        if (blockedMorning) return blockedMorning;
        return await handleChat(request, env, { forceNonStream: true });
      }

      if (url.pathname.startsWith('/uuhb/')) {
        if (!isAllowedOrigin(request)) {
          return json({ error: 'Origin not allowed' }, 403, request);
        }
        const blockedUuhb = await guardProtected(request, env);
        if (blockedUuhb) return blockedUuhb;
        return await handleUuhb(request, env, url.pathname.split('/')[2]);
      }

      if (url.pathname === '/lottery') {
        if (!env.LOTTERY_TOKEN) {
          return json({ error: '服务端未配置环境变量 LOTTERY_TOKEN' }, 503, request);
        }
        const type = url.searchParams.get('type') || 'ssq';
        const mun = url.searchParams.get('mun') || '1';
        const targetUrl = `http://api.yunmge.com/api/lottery?token=${env.LOTTERY_TOKEN}&mode=json&type=${type}&mun=${mun}`;
        const response = await fetch(targetUrl);
        return new Response(response.body, {
          headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/wallpaper') {
        const category = url.searchParams.get('category') || '';
        const response = await fetch(`https://api.mmp.cc/api/pcwallpaper?category=${category}&type=json`);
        return new Response(response.body, {
          headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/tts') {
        const TTS_API_URLS = [
          'https://tts.wangwangit.com/v1/audio/speech',
          'https://wnzctts.wnzc.workers.dev/v1/audio/speech',
        ];
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return json({ error: '请求体不是合法 JSON' }, 400, request);
        }
        const { input, voice, speed, pitch, style } = body;
        for (const ttsUrl of TTS_API_URLS) {
          try {
            const response = await fetch(ttsUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                input: input,
                voice: voice || 'zh-CN-XiaomengNeural',
                speed: speed || 0.9,
                pitch: pitch || 0,
                style: style || 'general',
              }),
            });
            if (response.ok) {
              return new Response(response.body, {
                headers: { ...corsHeaders(request), 'Content-Type': 'audio/mpeg' },
              });
            }
          } catch (e) {
            continue;
          }
        }
        return json({ error: 'TTS 服务不可用' }, 503, request);
      }

      if (url.pathname === '/heartWords') {
        return await handleHeartWords(request);
      }

      // 注意：如果线上部署的旧版本还有本文件没有的路由，
      // 覆盖部署前请先到 Cloudflare 控制台核对并补齐到这里，避免丢功能。
      return json({ error: 'Not Found' }, 404, request);
    } catch (err) {
      return json({ error: err.message }, 500, request);
    }
  },
};
