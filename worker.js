// Cloudflare Workers 代理脚本
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

// 并发控制 - 使用内存锁（单实例 Worker 适用）
const locks = {
  morning: false,
  tts: false
}

// ==================== 接口配置 ====================
const GLM_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const GLM_API_KEY = '8cb5d6c44a984a22a143ead8ac510d2f.9adwosowpPiml1Nq'
const TTS_API_URLS = [
  'https://tts.wangwangit.com/v1/audio/speech',
  'https://wnzctts.wnzc.workers.dev/v1/audio/speech'
]
// =================================================

async function handleRequest(request) {
  const url = new URL(request.url)
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  }

  // 处理 OPTIONS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // 彩票代理
    if (url.pathname === '/lottery') {
      const type = url.searchParams.get('type') || 'ssq'
      const mun = url.searchParams.get('mun') || '1'
      const targetUrl = `http://api.yunmge.com/api/lottery?token=6ad41ac5eed70a63382ff767103705b7&mode=json&type=${type}&mun=${mun}`
      const response = await fetch(targetUrl)
      const data = await response.text()
      return new Response(data, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 壁纸代理
    if (url.pathname === '/wallpaper') {
      const category = url.searchParams.get('category') || ''
      const response = await fetch(`https://api.mmp.cc/api/pcwallpaper?category=${category}&type=json`)
      const data = await response.text()
      return new Response(data, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ==================== 早安文案接口 ====================
    if (url.pathname === '/morning') {
      // 检查锁
      if (locks.morning) {
        return new Response(JSON.stringify({ error: '请求过于频繁，请稍后再试' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      locks.morning = true

      try {
        const body = await request.json()
        const messages = body.messages || []

        const response = await fetch(GLM_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GLM_API_KEY}`
          },
          body: JSON.stringify({
            model: 'glm-4.7-flash',
            messages: messages,
            stream: false,
            thinking: { type: 'disabled' },
            max_tokens: 65536,
            temperature: 1.0
          })
        })

        const data = await response.json()
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      } finally {
        locks.morning = false
      }
    }

    // ==================== TTS 语音合成接口 ====================
    if (url.pathname === '/tts') {
      // 检查锁
      if (locks.tts) {
        return new Response(JSON.stringify({ error: '请求过于频繁，请稍后再试' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      locks.tts = true

      try {
        const body = await request.json()
        const { input, voice, speed, pitch, style } = body

        // 尝试多个 TTS 接口
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
                style: style || 'general'
              })
            })

            if (response.ok) {
              const blob = await response.blob()
              return new Response(blob, {
                headers: { ...corsHeaders, 'Content-Type': 'audio/mpeg' }
              })
            }
          } catch (e) {
            continue
          }
        }

        return new Response(JSON.stringify({ error: 'TTS 服务不可用' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      } finally {
        locks.tts = false
      }
    }

    return new Response('OK', { headers: corsHeaders })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}
