// Cloudflare Workers 代理脚本
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

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

    return new Response('OK', { headers: corsHeaders })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}
