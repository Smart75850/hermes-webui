"""
STT SenseVoice Server — FunASR SenseVoiceSmall (原生粵語+普通話+英日韓)
Port 8792. 完全免費，本地運行。
"""
import asyncio, json, time, numpy as np, sys, os
from concurrent.futures import ThreadPoolExecutor
from websockets.asyncio.server import serve

PORT = 8792
SAMPLE_RATE = 16000

executor = ThreadPoolExecutor(max_workers=2)

print("[stt] Loading SenseVoiceSmall (yue+zh+en+ja+ko)...", flush=True)
from funasr import AutoModel

# 自動切換 device: cuda 如果有 GPU，否則 cpu
device = "cuda:0" if os.environ.get("CUDA_VISIBLE_DEVICES") else "cpu"
print(f"[stt] Using device: {device}", flush=True)

model = AutoModel(
    model="iic/SenseVoiceSmall",
    disable_update=True,
    device=device,
)

print(f"[stt] SenseVoiceSmall loaded! ws://127.0.0.1:{PORT}", flush=True)

# Language code mapping for itn
LANG_TAGS = {"auto": "auto", "yue": "zh", "zh": "zh", "en": "en", "ja": "ja", "ko": "ko"}


def transcribe_sync(audio_f32):
    """Run SenseVoice in thread. Returns (text, language)."""
    try:
        result = model.generate(
            input=audio_f32,
            language="auto",  # ★ 自動檢測語言
            use_itn=True,
            batch_size_s=30,
        )
        if result and len(result) > 0:
            item = result[0]
            text = (item.get("text") or "").strip()
            # SenseVoice output format: "<|zh|><|NEUTRAL|>你好世界" or just text
            # Clean up language/emotion tags
            if "|>" in text:
                parts = text.split("|>")
                text = parts[-1].strip()
            # Remove emotion tags like <|NEUTRAL|>, <|HAPPY|>
            import re
            text = re.sub(r'<\|[^|]+\|>', '', text).strip()
            return text
        return ""
    except Exception as e:
        print(f"[stt] error: {e}", flush=True)
        return ""


async def transcribe_async(audio_f32):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, transcribe_sync, audio_f32)


async def handle(websocket):
    buf = np.array([], dtype=np.float32)
    chunks_received = 0

    print(f"[stt] connected", flush=True)
    try:
        async for raw in websocket:
            if isinstance(raw, str):
                try:
                    msg = json.loads(raw)
                    if msg.get("action") == "finalize":
                        if len(buf) >= SAMPLE_RATE // 4:
                            text = await transcribe_async(buf)
                            await websocket.send(json.dumps({"type":"final","text":text} if text else {"type":"final","text":""}))
                        else:
                            await websocket.send(json.dumps({"type":"final","text":""}))
                        buf = np.array([], dtype=np.float32)
                        chunks_received = 0
                except Exception:
                    pass
                continue

            if not isinstance(raw, (bytes, bytearray)):
                continue

            # int16 from browser → float32 [-1,1]
            chunk_i16 = np.frombuffer(raw, dtype=np.int16)
            chunk_f32 = chunk_i16.astype(np.float32) / 32768.0
            buf = np.append(buf, chunk_f32)
            chunks_received += 1

            # Transcribe every 2 seconds
            if len(buf) >= SAMPLE_RATE * 2 or chunks_received >= 32:
                if len(buf) >= SAMPLE_RATE // 4:
                    text = await transcribe_async(buf)
                    if text:
                        await websocket.send(json.dumps({"type":"partial","text":text}))
                        print(f"[stt] → {text}", flush=True)
                buf = np.array([], dtype=np.float32)
                chunks_received = 0

    except Exception as e:
        print(f"[stt] error: {e}", flush=True)
    finally:
        if len(buf) >= SAMPLE_RATE // 4:
            try:
                text = await transcribe_async(buf)
                if text: await websocket.send(json.dumps({"type":"final","text":text}))
            except Exception: pass
        print(f"[stt] disconnected", flush=True)


async def main():
    async with serve(handle, "127.0.0.1", PORT, ping_interval=None, ping_timeout=None):
        print(f"[stt] ready", flush=True)
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    asyncio.run(main())
