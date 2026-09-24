# AI 猜词接口文档

> 服务：wnzc-proxy（OnRender）  
> 接口：`POST /guess`  
> 版本：2026-09  
> Content-Type：`application/json`

---

## 1. 功能说明

猜词游戏专用接口，两种模式：

| 模式 | `generate` | 行为 |
|------|------------|------|
| 生成谜底 | `true` | AI 生成一个常见词语，并给出类别提示 |
| 判定输入 | `false` | 根据用户提问或猜词，只回答 **是 / 否 / 不确定**，并标出是否猜对 |

**判定规则（`generate=false`）：**

1. 用户输入是**问题**（是否类 / 是什么类）→ 判断该问题对谜底是否成立
2. 用户输入是**猜词** → 判断是否与谜底为同一事物；同时用本地匹配标 `correct` / `win`
3. 信息不足、无法判断、边界模糊 → `不确定`
4. `answer` 只允许三个值：`是`、`否`、`不确定`

---

## 2. 请求

### 2.1 地址

```
POST https://wnzc-proxy.onrender.com/guess
```

本地调试：

```
POST http://127.0.0.1:8000/guess
```

### 2.2 请求头

| Header | 必填 | 说明 |
|--------|------|------|
| `Content-Type` | 是 | `application/json` |
| `X-TS` | 是 | 当前毫秒时间戳（字符串），有效窗口 5 分钟 |
| `X-SIG` | 是 | 签名，算法见下文 |

### 2.3 签名算法

与成语接龙接口相同：

```
X-SIG = HMAC_SHA256_HEX(SIGN_SECRET, X-TS)
```

- 默认 `SIGN_SECRET`：`wnzc-soft-sign-2026`（与前端 `src/ai-config.js` 的 `AI_SIGN.secret` 一致）
- 摘要为**小写十六进制**字符串
- 时间戳偏差超过 5 分钟返回 `401`

**Python：**

```python
import hmac, hashlib, time

ts = str(int(time.time() * 1000))
sig = hmac.new(b"wnzc-soft-sign-2026", ts.encode(), hashlib.sha256).hexdigest()
```

**JavaScript：**

```js
const ts = Date.now().toString();
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode('wnzc-soft-sign-2026'),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
);
const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ts));
const sig = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
```

**Shell：**

```bash
TS=$(date +%s000)
SIG=$(printf '%s' "$TS" | openssl dgst -sha256 -hmac 'wnzc-soft-sign-2026' | awk '{print $NF}')
```

### 2.4 请求体

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `generate` | boolean | 是 | `false` | `true`=生成谜底词；`false`=判定用户输入 |
| `text` | string | 判定时必填 | `null` | 用户输入（问题或猜词） |
| `word` | string | 判定时必填 | `null` | 正确的词 / 谜底 |

**生成谜底：**

```json
{
  "generate": true
}
```

**判定提问：**

```json
{
  "generate": false,
  "text": "是水果吗？",
  "word": "香蕉"
}
```

**判定猜词：**

```json
{
  "generate": false,
  "text": "香蕉",
  "word": "香蕉"
}
```

---

## 3. 响应

### 3.1 固定 JSON 结构

所有业务响应字段固定：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "action": "judge",
    "word": "香蕉",
    "category": "",
    "answer": "是",
    "text": "是水果吗？",
    "correct": false,
    "win": false
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | int | `1`=业务成功；`0`=参数错误 / AI 失败 |
| `msg` | string | 简要说明：`成功`、`成功（本地兜底出题）`、`参数错误`、`AI 判定失败` |
| `data.action` | string | `generate`=生成谜底；`judge`=判定输入 |
| `data.word` | string | 谜底词（生成时返回；判定时回显） |
| `data.category` | string | 词的类别提示（仅生成时有值，如 `食物`） |
| `data.answer` | string | **`是` / `否` / `不确定`**；生成模式为空串 `""` |
| `data.text` | string | 判定时回显用户输入；生成模式为空串 `""` |
| `data.correct` | boolean | 是否猜对谜底（`text` 与 `word` 一致，忽略空白与常见标点） |
| `data.win` | boolean | 是否获胜，**与 `correct` 同值**，便于前端直接读 |

### 3.2 生成谜底成功

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "action": "generate",
    "word": "香蕉",
    "category": "食物",
    "answer": "",
    "text": "",
    "correct": false,
    "win": false
  }
}
```

前端用法：把 `word` 存为本局谜底（不要展示给猜题人）；`category` 可作开局提示。

### 3.3 提问判定

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "action": "judge",
    "word": "香蕉",
    "category": "",
    "answer": "是",
    "text": "是水果吗？",
    "correct": false,
    "win": false
  }
}
```

说明：问题成立只回 `answer=是`，不算猜对（`correct`/`win` 仍为 `false`）。

### 3.4 猜词猜对

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "action": "judge",
    "word": "香蕉",
    "category": "",
    "answer": "是",
    "text": "香蕉",
    "correct": true,
    "win": true
  }
}
```

### 3.5 猜词猜错

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "action": "judge",
    "word": "香蕉",
    "category": "",
    "answer": "否",
    "text": "苹果",
    "correct": false,
    "win": false
  }
}
```

### 3.6 无法判断

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "action": "judge",
    "word": "香蕉",
    "category": "",
    "answer": "不确定",
    "text": "贵吗？",
    "correct": false,
    "win": false
  }
}
```

### 3.7 参数错误

```json
{
  "code": 0,
  "msg": "参数错误",
  "data": {
    "action": "judge",
    "word": "",
    "category": "",
    "answer": "不确定",
    "text": "",
    "correct": false,
    "win": false
  }
}
```

### 3.8 AI 判定失败

```json
{
  "code": 0,
  "msg": "AI 判定失败",
  "data": {
    "action": "judge",
    "word": "香蕉",
    "category": "",
    "answer": "不确定",
    "text": "是水果吗？",
    "correct": false,
    "win": false
  }
}
```

说明：AI 超时/异常时保守返回 `不确定`，客户端可提示重试。

### 3.9 生成兜底

AI 失败时返回本地兜底词，保证游戏能开局：

```json
{
  "code": 1,
  "msg": "成功（本地兜底出题）",
  "data": {
    "action": "generate",
    "word": "大象",
    "category": "动物",
    "answer": "",
    "text": "",
    "correct": false,
    "win": false
  }
}
```

---

## 4. HTTP 状态码

| 状态码 | 含义 | 处理建议 |
|--------|------|----------|
| 200 | 业务已处理（看 `code` / `data`） | 正常解析 |
| 401 | 缺少或错误的 `X-TS` / `X-SIG` | 检查签名与时间同步 |
| 429 | 请求过于频繁（默认 20 次/分钟/IP） | 按 `Retry-After` 等待后重试 |
| 500 | 服务端未配置 AI API Key | 运维配置环境变量 |
| 502 | 上游 AI 服务连接/响应失败 | 可重试；生成模式会自动兜底 |
| 422 | 请求体格式非法 | 检查 JSON 字段类型 |

---

## 5. 完整调用示例

### cURL

```bash
BASE=https://wnzc-proxy.onrender.com/guess
SECRET=wnzc-soft-sign-2026

call_guess() {
  local body="$1"
  local ts sig
  ts=$(date +%s000)
  sig=$(printf '%s' "$ts" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')
  curl -sS -X POST "$BASE" \
    -H 'Content-Type: application/json' \
    -H "X-TS: $ts" \
    -H "X-SIG: $sig" \
    -d "$body"
}

# 生成谜底
call_guess '{"generate":true}'

# 提问
call_guess '{"generate":false,"text":"是水果吗？","word":"香蕉"}'

# 猜词
call_guess '{"generate":false,"text":"香蕉","word":"香蕉"}'
```

### 前端封装

```js
async function callGuess(body) {
  const ts = Date.now().toString();
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode('wnzc-soft-sign-2026'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ts));
  const sig = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  const res = await fetch('https://wnzc-proxy.onrender.com/guess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TS': ts, 'X-SIG': sig },
    body: JSON.stringify(body)
  });
  return res.json();
}

// 1. 开局出题（把 word 藏好，可展示 category）
const open = await callGuess({ generate: true });
const secret = open.data.word;          // 仅前端保存，不要显示
const hint = open.data.category;        // 可选提示

// 2. 玩家每轮输入问题或猜测
const r = await callGuess({ generate: false, text: userInput, word: secret });

// 3. 分支处理
if (r.data.win) {
  // 🎉 猜对了：展示 secret / 结算
} else if (r.data.answer === '是') {
  // 问题成立
} else if (r.data.answer === '否') {
  // 问题不成立 / 猜错
} else {
  // 不确定
}
```

---

## 6. 前端接入建议

1. **开局**：`generate=true`，将 `word` 存为本局谜底；`category` 可选展示
2. **每轮**：把玩家输入和谜底一起提交（`text` + `word`）
3. **结果分支**（优先看是否获胜）：
   - `data.win === true` → 猜对了，本局胜利
   - 否则按 `data.answer`：`是` / `否` / `不确定` 回复
4. **猜对判定**：`correct` / `win` 要求 `text` 与 `word` 去掉空白和常见标点后完全一致；同义词、近义表述不会标 `win`（但 `answer` 仍可能是 `是`）
5. **失败重试**：`code === 0` 时提示稍后重试，不计入玩家次数更友好

---

## 7. 环境与限制

| 项 | 说明 |
|----|------|
| 生产地址 | `https://wnzc-proxy.onrender.com` |
| 限流 | 默认每 IP 每分钟 20 次 |
| 签名窗口 | 5 分钟 |
| AI 通道 | 服务端 `ACTIVE_PROVIDER` 决定（deepseek / agnes / glm） |
| API Key | 仅存于 Render 环境变量，不下发前端 |
| 与 `/idiom` 关系 | 同一服务、同一鉴权与限流 |

相关环境变量见仓库根目录 `.env.example`。  
成语接龙接口见 [`idiom-api.md`](./idiom-api.md)。

---

## 8. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-09 | 新增 `POST /guess` 生成谜底 + 判定提问/猜词 |
| 2026-09 | 响应增加 `correct` / `win` 字段（是否猜对谜底） |
