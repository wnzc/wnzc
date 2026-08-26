// ============================================================
//  Cloudflare Workers 统一代理（ES Module 语法）
//
//  ⚠️ 安全约定：任何密钥都不允许写在本文件或仓库里的任何地方，
//  一律存放在 Cloudflare Worker 的环境变量（加密 Secrets）中。
//
//  需要在 Cloudflare 控制台（或 wrangler secret put）配置：
//    AI_API_URL   AI 服务商接口地址，如 https://open.bigmodel.cn/api/paas/v4/chat/completions
//    AI_API_KEY   AI 服务商 API Key（必须是重发后的新 key，旧的已随 git 历史泄露）
//    AI_MODEL     模型名，如 glm-4.7-flash
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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

function json(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}

function requireEnv(env, names, request) {
  for (const name of names) {
    if (!env[name]) {
      return json({ error: `服务端未配置环境变量 ${name}` }, 500, request);
    }
  }
  return null;
}

// ==================== 统一 AI 对话代理 ====================
async function handleChat(request, env, { forceNonStream = false } = {}) {
  const missing = requireEnv(env, ['AI_API_URL', 'AI_API_KEY', 'AI_MODEL'], request);
  if (missing) return missing;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: '请求体不是合法 JSON' }, 400, request);
  }

  // model 一律以服务端配置为准，防止前端伪造参数刷别的模型
  const payload = {
    model: env.AI_MODEL,
    messages: Array.isArray(body.messages) ? body.messages : [],
    stream: forceNonStream ? false : body.stream === true,
  };
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.max_tokens !== undefined) payload.max_tokens = Math.min(Number(body.max_tokens) || 0, 65536) || undefined;
  if (body.thinking !== undefined) payload.thinking = body.thinking;

  const upstream = await fetch(env.AI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.AI_API_KEY}`,
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
        return await handleChat(request, env);
      }

      if (url.pathname === '/morning') {
        if (!isAllowedOrigin(request)) {
          return json({ error: 'Origin not allowed' }, 403, request);
        }
        return await handleChat(request, env, { forceNonStream: true });
      }

      if (url.pathname.startsWith('/uuhb/')) {
        if (!isAllowedOrigin(request)) {
          return json({ error: 'Origin not allowed' }, 403, request);
        }
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
