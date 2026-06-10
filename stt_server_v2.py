"""
STT Server v2 — faster-whisper (CTranslate2, 4x faster, better Cantonese)
Port 8792. small model for speed + accuracy balance.
"""
import asyncio, json, time, numpy as np, sys
from concurrent.futures import ThreadPoolExecutor
from websockets.asyncio.server import serve

PORT = 8792
SAMPLE_RATE = 16000

executor = ThreadPoolExecutor(max_workers=2)

print("[stt-v2] Loading faster-whisper tiny model...", flush=True)
from faster_whisper import WhisperModel

model = WhisperModel("small", device="cpu", compute_type="int8", num_workers=2)
print(f"[stt-v2] faster-whisper small loaded. ws://127.0.0.1:{PORT}", flush=True)


def transcribe_sync(audio_int16):
    """Run faster-whisper in thread."""
    audio_f32 = audio_int16.astype(np.float32) / 32768.0
    try:
        segments, info = model.transcribe(
            audio_f32,
            language="zh",
            beam_size=5,
            temperature=0.0,
            vad_filter=True,
            vad_parameters=dict(
                threshold=0.5,
                min_speech_duration_ms=300,
                min_silence_duration_ms=500,
            ),
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            repetition_penalty=1.2,
        )
        texts = []
        for seg in segments:
            t = seg.text.strip()
            # 過濾幻覺：重複字符、純標點、prompt 回聲
            if not t: continue
            if len(t) <= 1: continue
            if t in ("以下是粵語或普通話對話。", "以下是普通話對話。"): continue
            # 檢測重複模式（如 "對話對話對話" / "對,對,對"）
            chars = set(t.replace(',','').replace('，','').replace(' ',''))
            if len(chars) <= 2 and len(t) > 8: continue
            texts.append(t)
        return " ".join(texts)
    except Exception as e:
        print(f"[stt-v2] error: {e}", flush=True)
        return ""


async def transcribe_async(audio_int16):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, transcribe_sync, audio_int16)


async def handle(websocket):
    buf = np.array([], dtype=np.int16)
    chunks_received = 0

    print(f"[stt-v2] connected", flush=True)
    try:
        async for raw in websocket:
            if isinstance(raw, str):
                try:
                    msg = json.loads(raw)
                    if msg.get("action") == "finalize":
                        if len(buf) >= SAMPLE_RATE // 4:
                            text = await transcribe_async(buf)
                            await websocket.send(json.dumps({"type": "final", "text": text} if text else {"type": "final", "text": ""}))
                        else:
                            await websocket.send(json.dumps({"type": "final", "text": ""}))
                        buf = np.array([], dtype=np.int16)
                        chunks_received = 0
                except Exception:
                    pass
                continue

            if not isinstance(raw, (bytes, bytearray)):
                continue

            chunk = np.frombuffer(raw, dtype=np.int16)
            buf = np.append(buf, chunk)
            chunks_received += 1

            # Transcribe every ~2 seconds of audio or every 32 chunks
            if len(buf) >= int(SAMPLE_RATE * 2.5) or chunks_received >= 40:
                if len(buf) >= SAMPLE_RATE // 4:
                    text = await transcribe_async(buf)
                    if text:
                        await websocket.send(json.dumps({"type": "partial", "text": text}))
                        print(f"[stt-v2] → {text}", flush=True)
                buf = np.array([], dtype=np.int16)
                chunks_received = 0

    except Exception as e:
        print(f"[stt-v2] error: {e}", flush=True)
    finally:
        if len(buf) >= SAMPLE_RATE // 4:
            try:
                text = await transcribe_async(buf)
                if text:
                    await websocket.send(json.dumps({"type": "final", "text": text}))
            except Exception:
                pass
        print(f"[stt-v2] disconnected", flush=True)


async def main():
    async with serve(handle, "127.0.0.1", PORT, ping_interval=None, ping_timeout=None):
        print(f"[stt-v2] ready", flush=True)
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    asyncio.run(main())
