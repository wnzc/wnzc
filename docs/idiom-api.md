# 成语接龙接口文档

> 服务：wnzc-proxy（OnRender）  
> 接口：`POST /idiom`  
> 版本：2026-09  
> Content-Type：`application/json`

---

## 1. 功能说明

成语接龙游戏专用接口，两种模式：

| 模式 | `first` | 行为 |
|------|---------|------|
| 开局生成 | `true` | AI 自动生成一个真实四字成语，并给出释义与下一手拼音提示 |
| 判定接龙 | `false` | 校验用户填写的成语是否成立（真成语 + 首尾拼音接龙 + 不重复） |

**判定规则（`first=false`）：**

1. 必须是真实存在的四字成语（AI 裁定，普通词语、短语、编造内容均不通过）
2. 用户成语**第一个字**与上个成语**最后一个字**：同字，或无声调拼音相同（同音不同调可以，如「意 / 一」都是 `yi`）
3. 不得与本局 `used` 列表中的成语重复

---

## 2. 请求

### 2.1 地址

```
POST https://wnzc-proxy.onrender.com/idiom
```

本地调试：

```
POST http://127.0.0.1:8000/idiom
```

### 2.2 请求头

| Header | 必填 | 说明 |
|--------|------|------|
| `Content-Type` | 是 | `application/json` |
| `X-TS` | 是 | 当前毫秒时间戳（字符串），有效窗口 5 分钟 |
| `X-SIG` | 是 | 签名，算法见下文 |

### 2.3 签名算法

```
X-SIG = HMAC_SHA256_HEX(SIGN_SECRET, X-TS)
```

- 默认 `SIGN_SECRET`：`wnzc-soft-sign-2026`（与前端 `src/ai-config.js` 的 `AI_SIGN.secret` 一致）
- 摘要结果为**小写十六进制**字符串
- 时间戳与服务器时间偏差超过 5 分钟会返回 `401`

**Python 示例：**

```python
import hmac, hashlib, time

ts = str(int(time.time() * 1000))
sig = hmac.new(b"wnzc-soft-sign-2026", ts.encode(), hashlib.sha256).hexdigest()
# 请求头：X-TS=ts, X-SIG=sig
```

**JavaScript 示例：**

```js
const ts = Date.now().toString();
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode('wnzc-soft-sign-2026'),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
);
const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ts));
const sig = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
// 请求头：X-TS: ts, X-SIG: sig
```

**Shell 示例：**

```bash
TS=$(date +%s000)
SIG=$(printf '%s' "$TS" | openssl dgst -sha256 -hmac 'wnzc-soft-sign-2026' | awk '{print $NF}')
```

### 2.4 请求体

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `first` | boolean | 是 | `false` | `true`=第一次开局；`false`=判定用户成语 |
| `prev` | string | 判定时必填 | `null` | 上一个成语（四字汉字） |
| `word` | string | 判定时必填 | `null` | 用户填写的成语（四字汉字） |
| `used` | string[] | 否 | `null` | 本局已出现过的成语，用于防重复 |

**开局请求体：**

```json
{
  "first": true
}
```

**判定请求体：**

```json
{
  "first": false,
  "prev": "长长久久",
  "word": "酒过三巡",
  "used": ["长长久久"]
}
```

---

## 3. 响应

### 3.1 固定 JSON 结构

所有业务响应均为如下结构（字段固定，无额外/缺失字段）：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "valid": true,
    "action": "generate",
    "idiom": "意气风发",
    "meaning": "形容精神振奋，气概豪迈。",
    "reason": "",
    "nextPinyin": "fa"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | int | `1`=业务成功；`0`=参数错误 / AI 裁定失败 |
| `msg` | string | 简要说明，如 `成功`、`参数错误`、`AI 裁定失败` |
| `data.valid` | boolean | 本次是否成立。开局生成成功恒为 `true` |
| `data.action` | string | `generate`=开局生成；`judge`=判定用户成语 |
| `data.idiom` | string | 生成的成语，或判定时回显用户填写的成语 |
| `data.meaning` | string | 一句话释义；无则为空串 `""` |
| `data.reason` | string | 不通过原因；通过时为空串 `""` |
| `data.nextPinyin` | string | 下一手需接的**无声调拼音**小写（当前成语末字读音）；判定失败时为上个成语的末字拼音 |

### 3.2 开局成功

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "valid": true,
    "action": "generate",
    "idiom": "意气风发",
    "meaning": "形容精神振奋，气概豪迈。",
    "reason": "",
    "nextPinyin": "fa"
  }
}
```

前端用法：展示 `idiom` + `meaning`，提示玩家接以 `nextPinyin` 开头（同音即可）的成语。

### 3.3 判定通过

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "valid": true,
    "action": "judge",
    "idiom": "酒过三巡",
    "meaning": "酒席上酒喝过三遍，泛指宴饮。",
    "reason": "",
    "nextPinyin": "xun"
  }
}
```

示例：`prev=长长久久`（久 jiu）→ `word=酒过三巡`（酒 jiu）✅

### 3.4 判定不通过（业务正常，词不成立）

`code` 仍为 `1`（接口本身成功），`valid=false`，原因在 `reason`：

```json
{
  "code": 1,
  "msg": "成功",
  "data": {
    "valid": false,
    "action": "judge",
    "idiom": "马到成功",
    "meaning": "",
    "reason": "「马到成功」首字「马」没接住上个成语末字「久」（需首尾拼音相同）",
    "nextPinyin": "jiu"
  }
}
```

常见 `reason`：

| 场景 | reason 示例 |
|------|-------------|
| 不是四字 | `「酒」不是四个汉字的成语` |
| 本局重复 | `「酒过三巡」本局已经出现过` |
| 拼音没接上 | `「马到成功」首字「马」没接住上个成语末字「久」（需首尾拼音相同）` |
| 不是真成语 | `不是真实存在的四字成语`（或 AI 给出的具体原因） |

### 3.5 参数错误

```json
{
  "code": 0,
  "msg": "参数错误",
  "data": {
    "valid": false,
    "action": "judge",
    "idiom": "",
    "meaning": "",
    "reason": "非开局必须提供 prev（上个成语）和 word（用户成语）",
    "nextPinyin": ""
  }
}
```

### 3.6 AI 裁定失败

```json
{
  "code": 0,
  "msg": "AI 裁定失败",
  "data": {
    "valid": false,
    "action": "judge",
    "idiom": "一意孤行",
    "meaning": "",
    "reason": "AI 裁定失败，请稍后重试",
    "nextPinyin": "yi"
  }
}
```

说明：AI 超时/上游异常时保守判否，避免放行假成语；客户端可提示用户重试。

### 3.7 开局兜底

AI 失败时会返回本地兜底成语，保证游戏能开局：

```json
{
  "code": 1,
  "msg": "成功（本地兜底开局）",
  "data": {
    "valid": true,
    "action": "generate",
    "idiom": "画龙点睛",
    "meaning": "比喻在关键处点明实质，使内容更传神。",
    "reason": "",
    "nextPinyin": "jing"
  }
}
```

---

## 4. HTTP 状态码

| 状态码 | 含义 | 处理建议 |
|--------|------|----------|
| 200 | 业务已处理（看 `code` / `data.valid`） | 正常解析 |
| 401 | 缺少或错误的 `X-TS` / `X-SIG` | 检查签名与时间同步 |
| 429 | 请求过于频繁（默认 20 次/分钟/IP） | 按 `Retry-After` 等待后重试 |
| 500 | 服务端未配置 AI API Key | 运维配置环境变量 |
| 502 | 上游 AI 服务连接/响应失败 | 可重试；开局模式会自动兜底 |
| 422 | 请求体格式非法 | 检查 JSON 字段类型 |

---

## 5. 完整调用示例

### cURL

```bash
BASE=https://wnzc-proxy.onrender.com/idiom
SECRET=wnzc-soft-sign-2026

call_idiom() {
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

# 开局
call_idiom '{"first":true}'

# 判定：长长久久 → 酒过三巡
call_idiom '{"first":false,"prev":"长长久久","word":"酒过三巡","used":["长长久久"]}'
```

### 前端封装

```js
async function callIdiom(body) {
  const ts = Date.now().toString();
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode('wnzc-soft-sign-2026'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ts));
  const sig = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  const res = await fetch('https://wnzc-proxy.onrender.com/idiom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-TS': ts, 'X-SIG': sig },
    body: JSON.stringify(body)
  });
  return res.json();
}

// 开局
const open = await callIdiom({ first: true });
// open.data.idiom / open.data.meaning / open.data.nextPinyin

// 判定
const judge = await callIdiom({
  first: false,
  prev: '长长久久',
  word: '酒过三巡',
  used: ['长长久久']
});
if (judge.data.valid) {
  // 接龙成功，下一手接 judge.data.nextPinyin
} else {
  // 提示 judge.data.reason
}
```

---

## 6. 前端接入建议

1. **开局**：`first=true`，把 `idiom`、`meaning` 展示给玩家，输入框 placeholder 提示「接『nextPinyin』」
2. **玩家提交**：`first=false`，传 `prev`（上个成语）、`word`（玩家输入）、`used`（本局已用列表，双方都记）
3. **结果分支**：
   - `data.valid === true` → 得分/连击 +1，用 `data.idiom` 作为下一轮 `prev`，`data.nextPinyin` 作为提示
   - `data.valid === false` → 展示 `data.reason`，允许重新输入
   - `code === 0` → 网络/AI 异常，提示重试
4. **防重复**：双方出过的成语都放进 `used`；玩家提交成功后立刻 `markUsed`
5. **拼音规则**：无声调拼音相同即可（同音不同调可以），例如「意 / 一」都是 `yi` 可接

---

## 7. 环境与限制

| 项 | 说明 |
|----|------|
| 生产地址 | `https://wnzc-proxy.onrender.com` |
| 限流 | 默认每 IP 每分钟 20 次 |
| 签名窗口 | 5 分钟 |
| AI 通道 | 服务端 `ACTIVE_PROVIDER` 决定（deepseek / agnes / glm），前端不可指定 |
| API Key | 仅存于 Render 环境变量，不下发前端 |
| 依赖 | `pypinyin`（本地拼音硬校验），`fastapi` / `httpx` |

相关环境变量见仓库根目录 `.env.example`。

---

## 8. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-09 | 新增 `POST /idiom` 开局生成 + 判定接龙，固定 JSON 返回 |
