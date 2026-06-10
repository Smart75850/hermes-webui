"""
STT Server v3 — Record-then-Transcribe (錄晒一次過轉寫)
faster-whisper small. No streaming chunks — wait for complete audio, then transcribe.
"""
import asyncio, json, numpy as np
from concurrent.futures import ThreadPoolExecutor
from websockets.asyncio.server import serve
from faster_whisper import WhisperModel

PORT = 8792
SAMPLE_RATE = 16000
executor = ThreadPoolExecutor(max_workers=2)

print("[stt-v3] Loading faster-whisper base...", flush=True)
model = WhisperModel("base", device="cpu", compute_type="auto", num_workers=2)
print(f"[stt-v3] Ready. ws://127.0.0.1:{PORT}", flush=True)


def transcribe_sync(audio_f32):
    """Run faster-whisper on complete audio. Returns clean text."""
    try:
        segments, info = model.transcribe(
            audio_f32, language="zh", beam_size=5,
            temperature=0.0, vad_filter=True,
            vad_parameters=dict(threshold=0.35, min_speech_duration_ms=200, min_silence_duration_ms=400),
            condition_on_previous_text=False, no_speech_threshold=0.4,
        )
        texts = []
        for seg in segments:
            t = seg.text.strip()
            if not t or len(t) <= 1: continue
            # 過濾 hallucination
            if t in ("以下是粵語或普通話對話。", "以下是普通話對話。"): continue
            chars = set(t.replace(',','').replace('，','').replace(' ',''))
            if len(chars) <= 2 and len(t) > 8: continue
            texts.append(t)
        result = "".join(texts)
        print(f"[stt-v3] → {result[:100]}", flush=True)
        return result
    except Exception as e:
        print(f"[stt-v3] error: {e}", flush=True)
        return ""


async def transcribe_async(audio_f32):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, transcribe_sync, audio_f32)


async def handle(websocket):
    """Simple: accumulate audio, transcribe on finalize."""
    buf = np.array([], dtype=np.float32)
    print("[stt-v3] connected", flush=True)

    try:
        async for raw in websocket:
            if isinstance(raw, str):
                try:
                    msg = json.loads(raw)
                    if msg.get("action") == "finalize":
                        if len(buf) >= SAMPLE_RATE // 2:  # min 0.5s
                            text = await transcribe_async(buf)
                            await websocket.send(json.dumps({"type":"final","text":text}))
                        else:
                            await websocket.send(json.dumps({"type":"final","text":""}))
                        buf = np.array([], dtype=np.float32)
                except Exception: pass
                continue

            if not isinstance(raw, (bytes, bytearray)): continue
            chunk_i16 = np.frombuffer(raw, dtype=np.int16)
            chunk_f32 = chunk_i16.astype(np.float32) / 32768.0
            buf = np.append(buf, chunk_f32)

    except Exception as e:
        print(f"[stt-v3] error: {e}", flush=True)
    finally:
        print("[stt-v3] disconnected", flush=True)


async def main():
    async with serve(handle, "127.0.0.1", PORT, ping_interval=None, ping_timeout=None):
        await asyncio.get_running_loop().create_future()

if __name__ == "__main__":
    asyncio.run(main())
