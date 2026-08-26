# 密钥安全改造说明

> 2025-08 改造：所有 API 密钥从前端代码中移除，统一收敛到 Cloudflare Worker 环境变量。
> 此前密钥曾以明文提交进公开仓库（`ai-models.js`、`src/ai-config.js`），**git 历史中仍可查到，
> 相关 key 必须全部作废重发**，仅删代码是不够的。

## 一、必须由你手动完成的事（按顺序）

### 1. 作废并重发所有泄露的密钥

| 服务 | 旧 key 所在文件 | 操作 |
|------|----------------|------|
| 智谱 GLM (`8cb5d6c4...`) | ai-models.js（已删） | bigmodel.cn 控制台 → 删除旧 key → 新建 |
| DeepSeek (`sk-a68d43f3...`) | ai-models.js（已删） | 不用 DeepSeek 就直接作废即可 |
| Agnes (`sk-JK8qyN2h...`) | ai-models.js（已删） | agnes-ai.cn 控制台重发 |
| uuhb.cn (`ak_4e467b...`) | src/ai-config.js | uuhb 平台重发 |
| 彩票 token (`6ad41ac5...`) | worker.js / ai-config.js | yunmge 平台重发 |

### 2. 在 Cloudflare 配置环境变量

控制台路径：Workers & Pages → `wnzcweb` → Settings → Variables and Secrets → Add
（命令行方式：`npx wrangler secret put <名字>`）

| 变量名 | 值示例 | 说明 |
|--------|--------|------|
| `AI_API_URL` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | AI 服务商接口地址 |
| `AI_API_KEY` | 重发后的新 key | 只配你实际在用的那家即可 |
| `AI_MODEL` | `glm-4.7-flash` | 前端传什么 model 都会被覆盖成这个值 |
| `UUHB_API_KEY` | `ak_xxx`（新） | 运势 / 答案之书用 |
| `LOTTERY_TOKEN` | 新 token | 彩票接口；不配则 `/lottery` 返回 503 |

### 3. 覆盖部署新的 worker.js

⚠️ **部署前先打开 Cloudflare 控制台里的现有代码核对一遍**：
本地 `worker.js` 里没有 `/heartWords` 路由，但线上版本疑似有（index.html 在调用它）。
如果线上确实多了路由，把那段逻辑合并进本地 `worker.js` 后再整体粘贴覆盖，否则首页暖心话会失效。

## 二、本次代码改动清单

| 文件 | 改动 |
|------|------|
| `worker.js` | 改为 ES Module 写法；新增 `POST /chat`（AI 对话代理，支持流式透传）、`GET /uuhb/<service>`（fortune/answerbook 代理）；Origin 白名单校验；model 以服务端 `AI_MODEL` 为准；删除内存锁（在 Workers 多实例下无效） |
| `src/ai-config.js` | 删除全部明文 key；`API_URL` 指向 Worker `/chat`；`API_HEADER` 去掉 Authorization；uuhb 地址改为走 Worker 代理 |
| `src/fortune.html` / `src/answerbook.html` | 请求改为走 Worker `/uuhb/*`，不再携带 apiKey |
| `src/lottery.html` | 删除从未使用的 `TOKEN` 变量 |
| 10 个 AI 页面 + `ai-models.js` | 移除 `<script src="../ai-models.js">` 引用，文件本身已删除 |

页面业务逻辑零改动：各页仍使用 `API_URL` / `API_HEADER` / `GLM_MODEL` 这些旧变量名（`ai-config.js` 里保留了兼容定义），只是背后改走代理。

## 三、以后加新 AI 页面的姿势

```js
// 直接用全局常量，不要自己拼 Authorization：
fetch(API_URL, {
  method: 'POST',
  headers: API_HEADER,
  body: JSON.stringify({ messages: [...], stream: true })
});
```

换模型/换服务商只动 Cloudflare 环境变量，仓库不用提交任何东西。

## 四、可选的后续加固

- git 历史清洗：`pip install git-filter-repo` 后把 `ai-models.js` 从历史里抹掉（不洗也行，前提是第一步的 key 已全部作废）；
- Worker 侧限流：目前 Origin 校验只是软防护，若额度被盗刷可在 Cloudflare 开 WAF Rate Limiting 规则；
- `/chat` 可加 `caches.default` 缓存重复请求（对 fortune 这类固定问答尤其有效）。
