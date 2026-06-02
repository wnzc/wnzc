from fastapi import FastAPI
from fastapi.responses import FileResponse
from pydantic import BaseModel

import edge_tts
import uuid

app = FastAPI()

class TTSRequest(BaseModel):
    text: str
    voice: str = "zh-CN-XiaoxiaoNeural"

@app.get("/")
async def root():
    return {"status": "ok"}

@app.post("/tts")
async def tts(req: TTSRequest):

    filename = f"/tmp/{uuid.uuid4()}.mp3"

    communicate = edge_tts.Communicate(
        req.text,
        req.voice
    )

    await communicate.save(filename)

    return FileResponse(
        filename,
        media_type="audio/mpeg"
    )