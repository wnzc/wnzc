// ============================================================
//  AI 模型统一配置（唯一维护点）
//  【默认模型开关】只需修改 ACTIVE_MODEL 这一个字段即可全局更换模型！
//  可选值：'glm' | 'deepseek' | 'agnes'
//  更换服务商 / 密钥 / 模型名，只改本文件即可，前后端同时生效。
//  前端页面与 proxy-server.js 均引用本文件，勿在此写 export / import。
//
//  ⚠️ 安全说明：apiKey 必须从环境变量获取，严禁硬编码！
//  通过自建代理服务器转发请求，密钥存储在服务器环境变量中。
// ============================================================

const AI_MODELS = {
  ACTIVE_MODEL: 'agnes',

  // ---------- 智谱 GLM 大模型 ----------
  glm: {
    apiUrl: 'https://你的代理服务器地址/chat',  // 替换为你的 Render 地址
    model: 'glm-4.7-flash'
  },

  // ---------- DeepSeek 大模型 ----------
  deepseek: {
    apiUrl: 'https://你的代理服务器地址/chat',  // 替换为你的 Render 地址
    model: 'deepseek-v4-flash'
  },

  // ---------- Agnes 大模型 ----------
  agnes: {
    apiUrl: 'https://你的代理服务器地址/chat',  // 替换为你的 Render 地址
    model: 'agnes-2.5-flash'
  }
};
