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
        uuhbApiUrl: 'https://wnzc-proxy.onrender.com/uuhb',
        // 彩票 token（可选）
        lotteryApiUrl: 'https://wnzc-proxy.onrender.com/lottery'
    }
};

// 当前激活的模型配置（由 ai-models.js 的 AI_MODELS 提供）
const ACTIVE_CONFIG = AI_MODELS[AI_MODELS.ACTIVE_MODEL];

// ---------- 兼容旧变量名（业务页面可直接使用以下常量，无需改动） ----------
const API_URL = ACTIVE_CONFIG.apiUrl;
const API_HEADER = {
    'Content-Type': 'application/json'
    // Authorization 由服务端注入；X-TS / X-SIG 由下方 fetch 包装自动附加
};
const GLM_MODEL = ACTIVE_CONFIG.model;
const VOICE_API_URLS = AI_CONFIG.tts.voiceApiUrls;

// ============================================================
//  防盗刷：对代理域名请求自动附加时间戳签名（X-TS / X-SIG）
//  ⚠️ 这是软校验——secret 会出现在前端源码里，只能挡住裸刷脚本。
//  真正的额度保护仍依赖服务端限流 + AI 服务商预算上限。
//  必须与 server/app.py 的 SIGN_SECRET（或 Cloudflare Secret）保持一致。
// ============================================================
const AI_SIGN = {
    secret: 'wnzc-soft-sign-2026'
};

(function installAiSignFetch() {
    if (typeof window === 'undefined' || window.fetch.__aiSigned) return;

    function shouldSignUrl(url) {
        try {
            const u = new URL(url, location.href);
            const hostOk = /(^|\.)onrender\.com$|(^|\.)workers\.dev$/.test(u.hostname);
            const pathOk = u.pathname === '/chat' || u.pathname === '/morning' || u.pathname.includes('/uuhb/');
            return hostOk && pathOk;
        } catch (e) {
            return false;
        }
    }

    async function hmacSha256Hex(secret, message) {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            enc.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const buf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
        return Array.from(new Uint8Array(buf))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }

    const nativeFetch = window.fetch.bind(window);

    async function signedFetch(input, init) {
        try {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            const method = String(
                (init && init.method) || (input && input.method) || 'GET'
            ).toUpperCase();
            if (shouldSignUrl(url) && method !== 'OPTIONS' && method !== 'HEAD' && crypto && crypto.subtle) {
                const nextInit = Object.assign({}, init);
                const headers = new Headers(
                    (init && init.headers) || (input && input.headers) || undefined
                );
                const ts = Date.now().toString();
                headers.set('X-TS', ts);
                headers.set('X-SIG', await hmacSha256Hex(AI_SIGN.secret, ts));
                nextInit.headers = headers;
                return nativeFetch(input, nextInit);
            }
        } catch (e) {
            // 签名失败不阻断请求，交给服务端限流/验签兜底
        }
        return nativeFetch(input, init);
    }

    signedFetch.__aiSigned = true;
    window.fetch = signedFetch;
})();
