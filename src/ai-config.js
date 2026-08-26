// ============================================================
//  AI 统一配置中心
//  所有 AI 相关的 URL / model / Authorization 都集中管理。
//  如需修改模型配置（glm / deepseek / agnes），请同步更新根目录 ai-models.js。
//  页面通过 <script src="../ai-models.js"></script> + <script src="ai-config.js"></script> 引入。
//
//  ⚠️ 安全说明：所有第三方密钥必须从环境变量获取，严禁硬编码！
// ============================================================

const AI_CONFIG = {
    // ---------- TTS 语音合成（多个备用地址，按顺序尝试） ----------
    tts: {
        voiceApiUrls: [
            'https://tts.wangwangit.com/v1/audio/speech',
            'https://wnzctts.wnzc.workers.dev/v1/audio/speech'
        ],
        // 默认语音参数
        defaultVoice: 'zh-CN-XiaomengNeural',
        defaultSpeed: 0.9,
        defaultPitch: 0,
        defaultStyle: 'general'
    },

    // ---------- 其他第三方接口（通过代理服务器，密钥由服务端注入） ----------
    thirdParty: {
        // 运势 / 答案之书 等 uuhb.cn 系列
        uuhbApiUrl: 'https://wnzc-proxy.onrender.com/uuhb',  // 替换为你的 Render 地址
        // 彩票 token（可选）
        lotteryApiUrl: 'https://wnzc-proxy.onrender.com/lottery'  // 替换为你的 Render 地址
    }
};

// 当前激活的模型配置（由 ai-models.js 的 AI_MODELS 提供）
const ACTIVE_CONFIG = AI_MODELS[AI_MODELS.ACTIVE_MODEL];

// ---------- 兼容旧变量名（业务页面可直接使用以下常量，无需改动） ----------
const API_URL = ACTIVE_CONFIG.apiUrl;
const API_HEADER = {
    'Content-Type': 'application/json'
    // Authorization 由 Worker 服务端注入，前端无需处理
};
const GLM_MODEL = ACTIVE_CONFIG.model;
const VOICE_API_URLS = AI_CONFIG.tts.voiceApiUrls;
