import os
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

# 从环境变量读取密钥
AI_API_URL = os.getenv("AI_API_URL", "https://api.agnes-ai.cn/v1/chat/completions")
AI_API_KEY = os.getenv("AI_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "agnes-2.5-flash")
UUHB_API_KEY = os.getenv("UUHB_API_KEY", "")
LOTTERY_TOKEN = os.getenv("LOTTERY_TOKEN", "")

class ChatRequest(BaseModel):
    messages: List[dict]
    stream: Optional[bool] = False
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    thinking: Optional[dict] = None  # 支持完整的 thinking 对象

@app.get("/")
async def root():
    return {"status": "ok", "service": "wnzc-api-proxy"}

@app.post("/chat")
async def chat(request: ChatRequest):
    if not AI_API_KEY:
        raise HTTPException(status_code=500, detail="AI_API_KEY not configured")

    payload = {
        "model": AI_MODEL,
        "messages": request.messages,
        "stream": request.stream
    }

    if request.temperature is not None:
        payload["temperature"] = request.temperature
    if request.max_tokens is not None:
        payload["max_tokens"] = request.max_tokens
    if request.thinking is not None:
        # thinking 可以是布尔值或对象，直接传递
        payload["thinking"] = request.thinking

    headers = {
        "Authorization": f"Bearer {AI_API_KEY}",
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
        req = client.build_request("POST", AI_API_URL, json=payload, headers=headers)
        upstream = await client.send(req, stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        print(f"[ERROR] chat upstream connect failed: {e!r}")
        raise HTTPException(status_code=502, detail=f"上游服务连接失败：{e!r}")

    content_type = upstream.headers.get("content-type", "application/json")
    is_sse = request.stream or "text/event-stream" in content_type

    if is_sse:
        # 流式：原样透传字节流，保留 SSE 的空行分隔符
        async def stream_gen():
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            except httpx.HTTPError as e:
                print(f"[ERROR] chat stream interrupted: {e!r}")
            finally:
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
