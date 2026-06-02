from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import edge_tts
import io

app = FastAPI(title="Edge-TTS API")

# 定义 POST 请求的参数模型
class TTSRequest(BaseModel):
    text: str
    voice: str = "zh-CN-XiaoxiaoNeural"  # 默认使用晓晓
    rate: str = "+0%"                     # 语速调整，如 "+20%", "-10%"
    volume: str = "+0%"                   # 音量调整

@app.post("/tts")
async def text_to_speech(req: TTSRequest):
    if not req.text:
        raise HTTPException(status_code=400, detail="文本内容不能为空")
    
    try:
        # 初始化 Communicate 对象
        communicate = edge_tts.Communicate(
            text=req.text, 
            voice=req.voice, 
            rate=req.rate, 
            volume=req.volume
        )
        
        # 使用内存缓冲区保存音频流，避免写入本地磁盘
        buffer = io.BytesIO()
        
        # 异步流式写入缓冲区
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buffer.write(chunk["data"])
        
        # 将缓冲区指针重置到开头
        buffer.seek(0)
        
        # 返回音频流
        return StreamingResponse(
            buffer, 
            media_type="audio/mpeg",
            headers={"Content-Disposition": "attachment; filename=tts_output.mp3"}
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"语音合成失败: {str(e)}")

# 提供一个简单的 GET 接口，方便浏览器直接测试播放
@app.get("/tts")
async def text_to_speech_get(text: str = Query(...), voice: str = "zh-CN-XiaoxiaoNeural"):
    try:
        communicate = edge_tts.Communicate(text=text, voice=voice)
        buffer = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buffer.write(chunk["data"])
        buffer.seek(0)
        
        # 这里的 media_type 设为 audio/mpeg，浏览器会直接播放而不是下载
        return StreamingResponse(buffer, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 查询可用语音的接口（可选）
@app.get("/voices")
async def get_voices(language: str = None):
    voices = await edge_tts.list_voices()
    if language:
        # 筛选特定语言，如传入 "zh" 获取所有中文语音
        voices = [v for v in voices if language.lower() in v["Locale"].lower()]
    return voices
