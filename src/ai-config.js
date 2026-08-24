// ============================================================
//  AI 统一配置中心
//  所有 AI 相关的 URL / model / Authorization 都集中管理。
//  如需修改模型配置（glm / deepseek / agnes），请同步更新根目录 ai-models.js。
//  页面通过 <script src="../ai-models.js"></script> + <script src="ai-config.js"></script> 引入。
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

    // ---------- 其他第三方接口（各自的 key / token） ----------
    thirdParty: {
        // 运势 / 答案之书 等 uuhb.cn 系列
        uuhbApiKey: 'ak_4e467bef570aafa08c488b57bd3c54946e25f2b0ff2064a1',
        // 彩票 token
        lotteryToken: '6ad41ac5eed70a63382ff767103705b7'
    }
};

// 当前激活的模型配置（由 ai-models.js 的 AI_MODELS 提供）
const ACTIVE_CONFIG = AI_MODELS[AI_MODELS.ACTIVE_MODEL];

// ---------- 兼容旧变量名（业务页面可直接使用以下常量，无需改动） ----------
const API_URL = ACTIVE_CONFIG.apiUrl;
const API_HEADER = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + ACTIVE_CONFIG.apiKey
};
const GLM_MODEL = ACTIVE_CONFIG.model;
const VOICE_API_URLS = AI_CONFIG.tts.voiceApiUrls;
