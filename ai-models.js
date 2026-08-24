// ============================================================
//  AI 模型统一配置（唯一维护点）
//  【默认模型开关】只需修改 ACTIVE_MODEL 这一个字段即可全局更换模型！
//  可选值：'glm' | 'deepseek' | 'agnes'
//  更换服务商 / 密钥 / 模型名，只改本文件即可，前后端同时生效。
//  前端页面与 worker.js 均引用本文件，勿在此写 export / import。
// ============================================================

const AI_MODELS = {
  ACTIVE_MODEL: 'agnes',

  // ---------- 智谱 GLM 大模型 ----------
  glm: {
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    apiKey: '8cb5d6c44a984a22a143ead8ac510d2f.9adwosowpPiml1Nq',
    model: 'glm-4.7-flash'
  },

  // ---------- DeepSeek 大模型 ----------
  deepseek: {
    apiUrl: 'https://api.deepseek.com/chat/completions',
    apiKey: 'sk-a68d43f3858a41e7ad8baa152cf6a983',
    model: 'deepseek-v4-flash'
  },

  // ---------- Agnes 大模型 ----------
  agnes: {
    apiUrl: 'https://api.agnes-ai.cn/v1/chat/completions',
    apiKey: 'sk-JK8qyN2hWca6YEa6Owvisx4FuCely1zdo3sVFj9BOIC4159H',
    model: 'agnes-2.5-flash'
  }
};
