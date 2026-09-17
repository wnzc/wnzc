// ============================================================
//  AI 代理地址（前端只请求这里）
//
//  切换服务商/模型：改 server/app.py 里的 ACTIVE_PROVIDER 与 AI_PROVIDERS，
//  然后 git 提交并重新部署 Render。Environment 只配 Key（DEEPSEEK_API_KEY 等）。
//
//  前端统一 POST PROXY_URL，body 用 messages / stream 即可。
//
//  ⚠️ apiKey 严禁写在前端。
// ============================================================

const AI_MODELS = {
  // 自建对话代理（一般不用动）
  PROXY_URL: 'https://wnzc-proxy.onrender.com/chat',

  // 兼容旧页面读取：model 字段已无实际作用，服务端自行决定
  ACTIVE_MODEL: 'server',
  deepseek: { apiUrl: 'https://wnzc-proxy.onrender.com/chat', model: '' },
  agnes: { apiUrl: 'https://wnzc-proxy.onrender.com/chat', model: '' },
  glm: { apiUrl: 'https://wnzc-proxy.onrender.com/chat', model: '' }
};
