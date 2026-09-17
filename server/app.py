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
        "model": "glm-4.7-flash",
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
