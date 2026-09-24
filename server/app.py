import hashlib
import hmac
import os
import threading
import time
from collections import defaultdict

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import httpx

app = FastAPI(title="wnzc API Proxy")

# 添加 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应该限制为特定域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
#  AI 通道配置（写在代码里，切换模型不用改 Render 环境变量）
#
#  【唯一切换点】改 ACTIVE_PROVIDER 后 git 提交并重新部署：
#      'deepseek' | 'agnes' | 'glm'
#
#  【Key 只放在 Render Environment】（不要写进代码）：
#      DEEPSEEK_API_KEY / AGNES_API_KEY / GLM_API_KEY
#      或 AI_API_KEYS={"deepseek":"sk-...","agnes":"sk-..."}
#      兼容旧的 AI_API_KEY（只挂在当前 ACTIVE_PROVIDER 上）
#
#  前端只 POST /chat，忽略请求里的 model/provider。
# ============================================================

# ★★★ 只需要改这一行 ★★★
ACTIVE_PROVIDER = "deepseek"

AI_PROVIDERS = {
    "deepseek": {
        "url": "https://api.deepseek.com/chat/completions",
        "model": "deepseek-flash",
    },
    "agnes": {
        "url": "https://api.agnes-ai.cn/v1/chat/completions",
        "model": "agnes-3.0-flash",
    },
    "glm": {
        "url": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "model": "glm-5.3-flash",
    },
}


def _load_api_keys() -> dict:
    import json as _json

    keys: dict = {}
    raw = os.getenv("AI_API_KEYS", "").strip()
    if raw:
        try:
            data = _json.loads(raw)
            if isinstance(data, dict):
                for k, v in data.items():
                    if v:
                        keys[str(k).strip().lower()] = str(v).strip()
        except Exception:
            print("[WARN] AI_API_KEYS 不是合法 JSON，已忽略")
    for name in AI_PROVIDERS:
        val = os.getenv(f"{name.upper()}_API_KEY", "").strip()
        if val:
            keys[name] = val
    legacy = os.getenv("AI_API_KEY", "").strip()
    if legacy and ACTIVE_PROVIDER not in keys:
        keys[ACTIVE_PROVIDER] = legacy
    return keys


AI_PROVIDER = ACTIVE_PROVIDER.strip().lower()
if AI_PROVIDER not in AI_PROVIDERS:
    print(f"[WARN] 未知 ACTIVE_PROVIDER={AI_PROVIDER}，回退 deepseek")
    AI_PROVIDER = "deepseek"

AI_API_KEYS = _load_api_keys()
_preset = AI_PROVIDERS[AI_PROVIDER]
AI_API_URL = _preset["url"]
AI_MODEL = _preset["model"]
AI_API_KEY = AI_API_KEYS.get(AI_PROVIDER, "")


def resolve_ai_target() -> dict:
    """通道写在代码里；Key 只从环境变量读。"""
    return {
        "provider": AI_PROVIDER,
        "url": AI_PROVIDERS[AI_PROVIDER]["url"],
        "model": AI_PROVIDERS[AI_PROVIDER]["model"],
        "api_key": AI_API_KEYS.get(AI_PROVIDER, ""),
    }
UUHB_API_KEY = os.getenv("UUHB_API_KEY", "")
LOTTERY_TOKEN = os.getenv("LOTTERY_TOKEN", "")

# ---------- 防盗刷：IP 限流 + 时间戳签名 ----------
# SIGN_SECRET 为空则跳过签名（便于灰度部署）；前端 ai-config.js 中的 AI_SIGN.secret 必须一致。
DEFAULT_SIGN_SECRET = "wnzc-soft-sign-2026"
SIGN_SECRET = os.getenv("SIGN_SECRET", DEFAULT_SIGN_SECRET)
SIGN_WINDOW_MS = int(os.getenv("SIGN_WINDOW_MS", "300000"))  # 5 分钟
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "20"))
RATE_WINDOW_SEC = 60

_rate_lock = threading.Lock()
_rate_hits: dict[str, list[float]] = defaultdict(list)


def client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_rate_limit(request: Request, limit: int = RATE_LIMIT_PER_MIN) -> None:
    ip = client_ip(request)
    now = time.time()
    with _rate_lock:
        hits = [t for t in _rate_hits[ip] if now - t < RATE_WINDOW_SEC]
        if len(hits) >= limit:
            retry_after = max(1, int(RATE_WINDOW_SEC - (now - hits[0])) + 1)
            _rate_hits[ip] = hits
            raise HTTPException(
                status_code=429,
                detail="请求过于频繁，请稍后再试",
                headers={"Retry-After": str(retry_after)},
            )
        hits.append(now)
        _rate_hits[ip] = hits
        if len(_rate_hits) > 5000:
            cutoff = now - RATE_WINDOW_SEC
            for key in list(_rate_hits.keys()):
                kept = [t for t in _rate_hits[key] if t >= cutoff]
                if kept:
                    _rate_hits[key] = kept
                else:
                    del _rate_hits[key]


def verify_signature(request: Request) -> None:
    if not SIGN_SECRET:
        return
    ts = request.headers.get("x-ts")
    sig = request.headers.get("x-sig")
    if not ts or not sig:
        raise HTTPException(status_code=401, detail="缺少签名头 X-TS / X-SIG")
    try:
        ts_ms = int(ts)
    except ValueError:
        raise HTTPException(status_code=401, detail="签名时间戳无效")
    if abs(time.time() * 1000 - ts_ms) > SIGN_WINDOW_MS:
        raise HTTPException(status_code=401, detail="签名已过期")
    expected = hmac.new(SIGN_SECRET.encode("utf-8"), ts.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig.lower()):
        raise HTTPException(status_code=401, detail="签名校验失败")


def guard_protected(request: Request) -> None:
    """受保护路由统一入口：先限流，再验签。"""
    check_rate_limit(request)
    verify_signature(request)


def normalize_thinking(thinking, model: str) -> dict:
    """把前端统一的 thinking 参数映射为各服务商实际字段。

    前端约定（兼容两种写法）:
      - {"type": "enabled" | "disabled"}
      - true / false
      - 不传 → 默认关闭思考（多数文案/故事页省 token、降延迟）

    Agnes:     chat_template_kwargs.enable_thinking
    DeepSeek:  thinking.type
    """
    if thinking is None:
        enabled = False
    elif isinstance(thinking, bool):
        enabled = thinking
    elif isinstance(thinking, dict):
        t = thinking.get("type")
        if t == "enabled":
            enabled = True
        elif t == "disabled":
            enabled = False
        elif "enable_thinking" in thinking:
            enabled = bool(thinking["enable_thinking"])
        else:
            return {"thinking": thinking}
    else:
        enabled = False

    m = (model or "").lower()
    if "agnes" in m:
        return {"chat_template_kwargs": {"enable_thinking": enabled}}
    if "deepseek" in m:
        return {"thinking": {"type": "enabled" if enabled else "disabled"}}
    return {}


class ChatRequest(BaseModel):
    messages: List[dict]
    stream: Optional[bool] = False
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    thinking: Optional[dict] = None  # 支持完整的 thinking 对象
    # 以下字段仅兼容旧前端，服务端会忽略
    provider: Optional[str] = None
    model: Optional[str] = None

def _dbg(obj, limit: int = 2000) -> str:
    """调试日志用：JSON 序列化并截断，避免刷屏。"""
    try:
        s = obj if isinstance(obj, str) else __import__("json").dumps(obj, ensure_ascii=False)
    except Exception:
        s = repr(obj)
    if len(s) > limit:
        return s[:limit] + f"...(truncated, total {len(s)})"
    return s


@app.get("/")
async def root():
    return {
        "status": "ok",
        "service": "wnzc-api-proxy",
        "provider": AI_PROVIDER,
        "model": AI_MODEL,
        "configured_providers": sorted(AI_API_KEYS.keys()),
    }

@app.post("/chat")
async def chat(raw_request: Request, request: ChatRequest):
    guard_protected(raw_request)
    # 通道/模型/Key 全部服务端决定；忽略 request.provider / request.model
    ai = resolve_ai_target()
    if not ai["api_key"]:
        raise HTTPException(
            status_code=500,
            detail=f"服务端未配置 {ai['provider']} 的 API Key（请设置 AI_API_KEYS 或 {ai['provider'].upper()}_API_KEY）",
        )

    payload = {
        "model": ai["model"],
        "messages": request.messages,
        "stream": request.stream
    }

    if request.temperature is not None:
        payload["temperature"] = request.temperature
    if request.max_tokens is not None:
        payload["max_tokens"] = request.max_tokens
    # Agnes 用 chat_template_kwargs，DeepSeek 用 thinking.type
    payload.update(normalize_thinking(request.thinking, ai["model"]))

    print("=" * 60)
    print("[DEBUG] /chat 前端入参:", _dbg({
        "stream": request.stream,
        "temperature": request.temperature,
        "max_tokens": request.max_tokens,
        "thinking": request.thinking,
        "provider_hint": request.provider,
        "model_hint": request.model,
        "resolved": {"provider": ai["provider"], "model": ai["model"]},
        "messages_count": len(request.messages or []),
        "messages": request.messages,
    }))
    print("[DEBUG] /chat 发往上游 payload:", _dbg(payload))

    headers = {
        "Authorization": f"Bearer {ai['api_key']}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if request.stream else "application/json",
    }
    # 流式响应可能持续很久，read/pool 超时放宽到 300 秒
    timeout = httpx.Timeout(connect=15.0, read=300.0, write=30.0, pool=300.0)

    # 注意：不能用 async with！上下文退出会提前关闭连接，
    # 导致 StreamingResponse 读不到数据（前端表现为一直转圈无输出）。
    # 改为手动管理生命周期：在生成器的 finally 中关闭。
    client = httpx.AsyncClient(timeout=timeout)
    try:
        req = client.build_request("POST", ai["url"], json=payload, headers=headers)
        upstream = await client.send(req, stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        print(f"[ERROR] chat upstream connect failed: {e!r}")
        raise HTTPException(status_code=502, detail=f"上游服务连接失败：{e!r}")

    content_type = upstream.headers.get("content-type", "application/json")
    is_sse = request.stream or "text/event-stream" in content_type
    print(f"[DEBUG] /chat 上游响应 status={upstream.status_code} content_type={content_type} sse={is_sse}")

    if is_sse:
        # 流式：原样透传字节流，保留 SSE 的空行分隔符
        sse_parts: list = []
        sse_bytes = 0

        async def stream_gen():
            nonlocal sse_bytes
            try:
                async for chunk in upstream.aiter_raw():
                    sse_bytes += len(chunk)
                    if len(sse_parts) < 30:
                        try:
                            sse_parts.append(chunk.decode("utf-8", errors="replace"))
                        except Exception:
                            pass
                    yield chunk
            except httpx.HTTPError as e:
                print(f"[ERROR] chat stream interrupted: {e!r}")
            finally:
                print(f"[DEBUG] /chat SSE 完成 bytes={sse_bytes} preview={_dbg(''.join(sse_parts), 1500)}")
                await upstream.aclose()
                await client.aclose()

        return StreamingResponse(
            stream_gen(),
            status_code=upstream.status_code,
            media_type=content_type or "text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Access-Control-Allow-Origin": "*",
            },
        )
    else:
        # 非流式：读完即关
        try:
            if upstream.status_code != 200:
                body = await upstream.aread()
                print(f"[ERROR] chat upstream {upstream.status_code}: {body[:500]!r}")
                return JSONResponse(
                    content={"error": f"上游服务错误: {body.decode(errors='replace')[:500]}"},
                    status_code=upstream.status_code,
                    headers={"Access-Control-Allow-Origin": "*"},
                )
            data = await upstream.aread()
            print(f"[DEBUG] /chat 非流式响应 body: {_dbg(data.decode(errors='replace'), 1500)}")
            return Response(
                content=data,
                status_code=upstream.status_code,
                media_type=content_type or "application/json",
                headers={"Access-Control-Allow-Origin": "*"},
            )
        finally:
            await upstream.aclose()
            await client.aclose()

@app.get("/uuhb/{service}")
async def uuhb_proxy(service: str, request: Request):
    guard_protected(request)
    if not UUHB_API_KEY:
        raise HTTPException(status_code=500, detail="UUHB_API_KEY not configured")
    
    valid_services = ["fortune", "answerbook"]
    if service not in valid_services:
        raise HTTPException(status_code=404, detail=f"不支持的服务：{service}，支持：{valid_services}")
    
    # 获取查询参数
    params = {}
    for key, value in request.query_params.items():
        if key != "apiKey":
            params[key] = value
    
    target_url = f"https://v1.uuhb.cn/v1/{service}"
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                target_url,
                params={**params, "apiKey": UUHB_API_KEY},
                timeout=30.0
            )
            
            # 记录日志便于调试
            print(f"[DEBUG] uuhb proxy: status={response.status_code}, url={target_url}, params={params}")
            
            return JSONResponse(
                content=response.json(),
                headers={"Access-Control-Allow-Origin": "*"}
            )
        except httpx.HTTPError as e:
            print(f"[ERROR] uuhb proxy error: {str(e)}")
            raise HTTPException(status_code=502, detail=f"上游服务错误：{str(e)}")

@app.get("/lottery")
async def lottery_proxy(request: Request):
    if not LOTTERY_TOKEN:
        raise HTTPException(status_code=503, detail="LOTTERY_TOKEN not configured")
    
    type_param = request.query_params.get("type", "ssq")
    mun_param = request.query_params.get("mun", "1")
    
    target_url = f"http://api.yunmge.com/api/lottery?token={LOTTERY_TOKEN}&mode=json&type={type_param}&mun={mun_param}"
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(target_url, timeout=30.0)
            
            return JSONResponse(
                content=response.json(),
                headers={"Access-Control-Allow-Origin": "*"}
            )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"上游服务错误：{str(e)}")

@app.get("/heartWords")
async def heart_words():
    """首页暖心话"""
    from datetime import datetime

    # 时段问候
    hour = datetime.now().hour
    if hour < 5:
        greeting = "夜深了，注意休息"
    elif hour < 9:
        greeting = "早上好，新的一天加油"
    elif hour < 12:
        greeting = "上午好，元气满满"
    elif hour < 14:
        greeting = "中午好，记得吃午饭"
    elif hour < 18:
        greeting = "下午好，劳逸结合"
    else:
        greeting = "晚上好，今天辛苦了"

    # 一言
    sentence = ""
    from_data = ""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://v1.hitokoto.cn/?c=d&c=e&c=i",
                headers={"User-Agent": "wnzc-proxy"},
                timeout=10.0
            )
            if resp.ok:
                data = resp.json()
                sentence = data.get("hitokoto", "")
                from_data = data.get("from", "")
    except:
        pass

    nxyj = sentence if sentence else "愿你在平凡的日子里，也能闪闪发光。"
    if from_data:
        nxyj = f"{sentence} ——「{from_data}」"

    return JSONResponse(
        content={"code": 1, "msg": greeting, "nxyj": nxyj},
        headers={"Access-Control-Allow-Origin": "*"}
    )


# ============================================================
#  成语接龙 API
#
#  POST /idiom
#  入参 JSON：
#    {
#      "first": true,            // 是否第一次开局（true 时 AI 自动生成成语）
#      "prev": "一心一意",        // 上个成语（first=false 时必填）
#      "word": "意气风发",        // 用户填写的成语（first=false 时必填）
#      "used": ["一心一意"]       // 可选：本局已出现过的成语，用于防重复
#    }
#
#  出参 JSON（固定格式）：
#    {
#      "code": 1,                // 1=接口成功，0=参数错误/AI失败
#      "msg": "成功",
#      "data": {
#        "valid": true,          // 本次是否成立（开局生成成功恒为 true）
#        "action": "generate",   // generate=开局生成 | judge=判定用户成语
#        "idiom": "意气风发",     // 生成的成语，或判定通过时回显用户成语
#        "meaning": "……",        // 一句话释义（无则空串）
#        "reason": "",           // 不通过原因（通过时为空串）
#        "nextPinyin": "fa"      // 下一手需接的无声调拼音（末字读音）
#      }
#    }
#
#  判定规则（first=false）：
#    1. 必须是真实四字成语（AI 裁定，不能是普通词/编造）
#    2. 用户成语首字与上个成语末字：同字，或无声调拼音相同（同音不同调可）
#    3. 不得与 used 中的成语重复
# ============================================================

IDIOM_RE = r"^[一-龥]{4}$"

# AI 失败时的开局兜底（保证游戏能开）：(成语, 释义, 末字无声调拼音)
_FALLBACK_IDIOMS = [
    ("一心一意", "形容做事专心一意，不分心。", "yi"),
    ("画龙点睛", "比喻在关键处点明实质，使内容更传神。", "jing"),
    ("胸有成竹", "比喻做事之前已有通盘的考虑。", "zhu"),
    ("水到渠成", "比喻条件成熟，事情自然会成功。", "cheng"),
    ("温故知新", "复习旧的知识，从中获得新的理解和体会。", "xin"),
]


class IdiomRequest(BaseModel):
    first: bool = False
    prev: Optional[str] = None
    word: Optional[str] = None
    used: Optional[List[str]] = None


def _is_four_han(s: Optional[str]) -> bool:
    import re
    return bool(s) and bool(re.match(IDIOM_RE, s.strip()))


def _toneless_pinyins(ch: str) -> set:
    """无声调拼音集合；pypinyin 不可用或查不到时返回空集。"""
    try:
        from pypinyin import pinyin, Style
    except ImportError:
        return set()
    try:
        return {item[0] for item in pinyin(ch, style=Style.NORMAL, heteronym=True) if item and item[0]}
    except Exception:
        return set()


def _chars_match(a: str, b: str):
    """同字或同音：True/False；缺拼音字典时返回 None（交给 AI 裁定）。"""
    if not a or not b:
        return False
    if a == b:
        return True
    pa, pb = _toneless_pinyins(a), _toneless_pinyins(b)
    if not pa or not pb:
        return None
    return bool(pa & pb)


def _next_pinyin(idiom: str, fallback: str = "") -> str:
    if not idiom or len(idiom) < 4:
        return (fallback or "").strip().lower()
    pys = _toneless_pinyins(idiom[-1])
    if pys:
        return sorted(pys)[0]
    return (fallback or "").strip().lower()


def _extract_json(text: str) -> dict:
    """从 AI 回复里抠出第一段 JSON 对象。"""
    import json as _json
    import re as _re
    if not text:
        return {}
    s = text.strip()
    # 去掉 ```json ... ``` 围栏
    fence = _re.search(r"```(?:json)?\s*(\{.*?\})\s*```", s, _re.S)
    if fence:
        s = fence.group(1)
    start = s.find("{")
    end = s.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        obj = _json.loads(s[start : end + 1])
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


async def _ai_json(system: str, user: str, temperature: float = 0.3) -> dict:
    """调用当前 AI 通道，要求只回 JSON，返回解析后的 dict（失败返回 {}）。"""
    ai = resolve_ai_target()
    if not ai["api_key"]:
        raise HTTPException(
            status_code=500,
            detail=f"服务端未配置 {ai['provider']} 的 API Key（请设置 AI_API_KEYS 或 {ai['provider'].upper()}_API_KEY）",
        )
    payload = {
        "model": ai["model"],
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {ai['api_key']}",
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(connect=15.0, read=60.0, write=30.0, pool=60.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.post(ai["url"], json=payload, headers=headers)
        except httpx.HTTPError as e:
            print(f"[ERROR] idiom AI connect failed: {e!r}")
            raise HTTPException(status_code=502, detail=f"上游 AI 服务连接失败：{e!r}")
        if resp.status_code != 200:
            body = resp.text[:500]
            print(f"[ERROR] idiom AI {resp.status_code}: {body}")
            raise HTTPException(status_code=502, detail=f"上游 AI 服务错误：{body}")
        try:
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
        except Exception as e:
            print(f"[ERROR] idiom AI bad body: {e!r} / {resp.text[:500]}")
            return {}
    return _extract_json(content or "")


def _idiom_response(action: str, valid: bool, idiom: str = "", meaning: str = "",
                    reason: str = "", next_pinyin: str = "", code: int = 1, msg: str = "成功") -> JSONResponse:
    return JSONResponse(
        content={
            "code": code,
            "msg": msg,
            "data": {
                "valid": bool(valid),
                "action": action,
                "idiom": idiom or "",
                "meaning": meaning or "",
                "reason": reason or "",
                "nextPinyin": next_pinyin or "",
            },
        },
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.post("/idiom")
async def idiom_chain(raw_request: Request, request: IdiomRequest):
    """成语接龙：开局 AI 出题 / 非开局 AI 判定用户成语是否成立。"""
    guard_protected(raw_request)

    # ---------- 开局：AI 生成成语 ----------
    if request.first:
        system = (
            "你是成语接龙出题人。只输出一行 JSON，不要任何其它文字。\n"
            "生成一个真实、常见、标准的四字成语（不能是普通词语或编造内容）。\n"
            "nextPinyin 填该成语最后一个字的无声调拼音小写（如 yi、feng）。\n"
            '格式：{"idiom":"四字成语","meaning":"一句话释义","nextPinyin":"拼音"}'
        )
        user = "请生成一个用于成语接龙开局的四字成语。"
        try:
            data = await _ai_json(system, user, temperature=0.8)
        except HTTPException:
            data = {}
        idiom = str(data.get("idiom") or "").strip()
        meaning = str(data.get("meaning") or "").strip()
        if _is_four_han(idiom):
            nxt = _next_pinyin(idiom, str(data.get("nextPinyin") or ""))
            return _idiom_response("generate", True, idiom, meaning, "", nxt)
        # AI 超时/格式错 → 兜底开局，保证前端能玩
        import random
        fb_idiom, fb_meaning, fb_py = random.choice(_FALLBACK_IDIOMS)
        return _idiom_response(
            "generate", True, fb_idiom, fb_meaning, "",
            _next_pinyin(fb_idiom, fb_py), code=1, msg="成功（本地兜底开局）",
        )

    # ---------- 非开局：判定用户成语 ----------
    prev = (request.prev or "").strip()
    word = (request.word or "").strip()
    used = [str(x).strip() for x in (request.used or []) if str(x).strip()]

    if not prev or not word:
        return _idiom_response(
            "judge", False, word, "", "非开局必须提供 prev（上个成语）和 word（用户成语）",
            "", code=0, msg="参数错误",
        )
    if not _is_four_han(prev):
        return _idiom_response(
            "judge", False, word, "", "上个成语必须是四个汉字",
            "", code=0, msg="参数错误",
        )
    if not _is_four_han(word):
        return _idiom_response(
            "judge", False, word, "", "「%s」不是四个汉字的成语" % word,
            _next_pinyin(prev), code=1, msg="成功",
        )
    if word in used or word == prev:
        return _idiom_response(
            "judge", False, word, "", "「%s」本局已经出现过" % word,
            _next_pinyin(prev), code=1, msg="成功",
        )

    # 本地拼音硬校验：明确不匹配才直接否（缺字典时 None，交给 AI）
    required, first_ch = prev[-1], word[0]
    if _chars_match(required, first_ch) is False:
        return _idiom_response(
            "judge", False, word, "",
            "「%s」首字「%s」没接住上个成语末字「%s」（需首尾拼音相同）" % (word, first_ch, required),
            _next_pinyin(prev), code=1, msg="成功",
        )

    # AI 裁定：是否真实成语（+ 释义 / 末字拼音备份）
    need_py = _next_pinyin(prev)
    system = (
        "你是成语接龙裁判。只输出一行 JSON，不要任何其它文字。\n"
        "判断用户填写的四字内容是否【真实存在的成语】（固定短语，不是普通词语、句子或编造）。\n"
        "并核对接龙：用户成语【第一个字】的无声调拼音，必须与上个成语【最后一个字】的无声调拼音相同（同字或同音不同调均可）。\n"
        "nextPinyin 填用户成语最后一个字的无声调拼音小写。\n"
        "全部通过：{\"valid\":true,\"meaning\":\"一句话释义\",\"reason\":\"\",\"nextPinyin\":\"拼音\"}\n"
        "不通过：{\"valid\":false,\"meaning\":\"\",\"reason\":\"不成立原因\",\"nextPinyin\":\"\"}"
    )
    used_hint = "、".join(used[-20:]) if used else "（无）"
    user = (
        f"上个成语：{prev}（末字「{required}」需接拼音 {need_py or '未知'}）\n"
        f"用户成语：{word}\n"
        f"本局已用：{used_hint}\n"
        f"请判断「{word}」是否成立（真成语 + 首尾拼音接龙）。"
    )
    try:
        data = await _ai_json(system, user, temperature=0.2)
    except HTTPException:
        data = {}

    # AI 没回出可用结论时，保守判否，避免放行假成语
    if not data or "valid" not in data:
        return _idiom_response(
            "judge", False, word, "", "AI 裁定失败，请稍后重试",
            _next_pinyin(prev), code=0, msg="AI 裁定失败",
        )

    valid = bool(data.get("valid"))
    meaning = str(data.get("meaning") or "").strip()
    reason = str(data.get("reason") or "").strip()
    nxt = _next_pinyin(word, str(data.get("nextPinyin") or ""))

    if valid:
        return _idiom_response("judge", True, word, meaning, "", nxt)
    return _idiom_response(
        "judge", False, word, "",
        reason or "「%s」不是真实存在的四字成语" % word,
        _next_pinyin(prev),
    )


# ============================================================
#  AI 猜词 API
#
#  POST /guess
#  入参 JSON：
#    {
#      "generate": true,          // true=生成谜底词；false=判定用户提问/猜词
#      "text": "是水果吗？",       // 用户输入（generate=false 时必填）
#      "word": "苹果"             // 正确的词/谜底（generate=false 时必填）
#    }
#
#  出参 JSON（固定格式）：
#    {
#      "code": 1,                 // 1=成功，0=参数错误/AI失败
#      "msg": "成功",
#      "data": {
#        "action": "generate",    // generate=生成词 | judge=判定
#        "word": "苹果",           // 生成的词 / 判定时回显谜底
#        "category": "食物",       // 词的类别提示（生成时有值，便于出题）
#        "answer": "是",           // 判定结论：是 | 否 | 不确定（生成时为空串）
#        "text": "是水果吗？",     // 判定时回显用户输入（生成时为空串）
#        "correct": false,        // 是否猜对谜底（text 与 word 一致）
#        "win": false             // 是否获胜（与 correct 同值，便于前端直接读）
#      }
#    }
#
#  判定约定（generate=false）：
#    - 用户输入是问题（是否类）→ 判断该问题对谜底是否成立
#    - 用户输入是猜词 → 判断是否与谜底为同一事物
#    - answer 只允许：是 / 否 / 不确定
# ============================================================

# 生成失败时的兜底谜底：(词, 类别)
_FALLBACK_GUESS_WORDS = [
    ("苹果", "食物"),
    ("太阳", "自然"),
    ("大象", "动物"),
    ("汽车", "交通"),
    ("电脑", "科技"),
    ("雨伞", "生活用品"),
    ("钢琴", "乐器"),
    ("长城", "地点"),
]

_GUESS_ANSWERS = {"是", "否", "不确定"}


class GuessRequest(BaseModel):
    generate: bool = False
    text: Optional[str] = None
    word: Optional[str] = None


def _guess_response(action: str, word: str = "", category: str = "",
                    answer: str = "", text: str = "",
                    correct: bool = False,
                    code: int = 1, msg: str = "成功") -> JSONResponse:
    hit = bool(correct)
    return JSONResponse(
        content={
            "code": code,
            "msg": msg,
            "data": {
                "action": action,
                "word": word or "",
                "category": category or "",
                "answer": answer or "",
                "text": text or "",
                "correct": hit,
                "win": hit,
            },
        },
        headers={"Access-Control-Allow-Origin": "*"},
    )


def _is_word_hit(text: str, word: str) -> bool:
    """用户是否猜对谜底：text 与 word 一致（忽略空白与常见标点）。"""
    import re as _re
    t = _re.sub(r"[\s。！？!?～~、，,．.]", "", text or "")
    w = _re.sub(r"[\s]", "", word or "")
    return bool(w) and t == w


def _normalize_guess_answer(raw) -> str:
    """把 AI 回答收敛为 是 / 否 / 不确定。"""
    s = str(raw or "").strip()
    if s in _GUESS_ANSWERS:
        return s
    if not s:
        return "不确定"
    if s.startswith("不确定") or any(k in s for k in ("无法确定", "不好说", "难说")):
        return "不确定"
    if s.startswith("是") or s in ("对", "正确", "是的", "yes", "y", "true"):
        return "是"
    if s.startswith("否") or s.startswith("不") or s in ("不对", "错误", "no", "n", "false"):
        return "否"
    return "不确定"


@app.post("/guess")
async def guess_word(raw_request: Request, request: GuessRequest):
    """AI 猜词：开局生成谜底 / 判定用户问题或猜词（只回 是/否/不确定）。"""
    guard_protected(raw_request)

    # ---------- 生成谜底词 ----------
    if request.generate:
        system = (
            "你是猜词游戏出题人。只输出一行 JSON，不要任何其它文字。\n"
            "生成一个常见的、适合用是否类问题来猜的中文词（1~4 字，名词为主，如水果、动物、物品、地点）。\n"
            "要求：词要正常、常见、无歧义，不要生僻词、品牌、人名、敏感内容。\n"
            "category 填大类，如：食物 / 动物 / 自然 / 交通 / 科技 / 生活用品 / 乐器 / 地点 / 运动 等。\n"
            '格式：{"word":"词语","category":"类别"}'
        )
        user = "请生成一个用于猜词游戏的谜底词。"
        try:
            data = await _ai_json(system, user, temperature=0.8)
        except HTTPException:
            data = {}
        word = str(data.get("word") or "").strip()
        category = str(data.get("category") or "").strip()
        if word and 1 <= len(word) <= 8 and not any(c.isspace() for c in word):
            return _guess_response("generate", word=word, category=category, correct=False)
        # AI 失败 → 兜底词，保证游戏能开
        import random
        fb_word, fb_cat = random.choice(_FALLBACK_GUESS_WORDS)
        return _guess_response(
            "generate", word=fb_word, category=fb_cat, correct=False,
            code=1, msg="成功（本地兜底出题）",
        )

    # ---------- 判定：问题 / 猜词 ----------
    text = (request.text or "").strip()
    word = (request.word or "").strip()
    if not text or not word:
        return _guess_response(
            "judge", word=word, text=text, answer="不确定", correct=False,
            code=0, msg="参数错误",
        )

    system = (
        "你是猜词游戏裁判。只输出一行 JSON，不要任何其它文字。\n"
        "已知谜底词，判断用户输入（可能是问题，也可能是猜词）应如何回答。\n"
        "规则：\n"
        "1. 若用户是在提问（是否类/是什么类），判断该问题对谜底是否成立。\n"
        "2. 若用户是在猜词，判断是否与谜底是同一事物（同物异名算「是」，明显不同算「否」）。\n"
        "3. 信息不足、问题本身无法判断、或边界模糊时，回答「不确定」。\n"
        "answer 只能是：是、否、不确定。\n"
        '格式：{"answer":"是"} 或 {"answer":"否"} 或 {"answer":"不确定"}'
    )
    user_msg = f"谜底词：{word}\n用户输入：{text}\n请判断 answer。"
    try:
        data = await _ai_json(system, user_msg, temperature=0.1)
    except HTTPException:
        data = {}

    if not data or "answer" not in data:
        return _guess_response(
            "judge", word=word, text=text, answer="不确定", correct=False,
            code=0, msg="AI 判定失败",
        )

    answer = _normalize_guess_answer(data.get("answer"))
    correct = _is_word_hit(text, word)
    return _guess_response("judge", word=word, text=text, answer=answer, correct=correct)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
