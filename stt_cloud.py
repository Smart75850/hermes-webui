"""
STT Cloud Server — OpenAI Whisper API (fast, accurate, Cantonese support)
Port 8792. No model loading, instant start.
Uses DEEPSEEK_API_KEY from environment (or OPENAI_API_KEY).
"""
import asyncio, json, time, numpy as np, os, io, wave
from websockets.asyncio.server import serve
from openai import OpenAI

PORT = 8792
SAMPLE_RATE = 16000

# Use DeepSeek or OpenAI key
api_key = os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY")
if not api_key:
    print("[stt-cloud] ERROR: No API key found. Set DEEPSEEK_API_KEY or OPENAI_API_KEY", flush=True)
    exit(1)

# Try OpenAI first, fall back to DeepSeek compatible endpoint
base_url = os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1"
client = OpenAI(api_key=api_key, base_url=base_url)
print(f"[stt-cloud] OpenAI client ready. ws://127.0.0.1:{PORT}", flush=True)


def transcribe_sync(audio_int16, lang="yue"):
    """Send audio to OpenAI Whisper API."""
    try:
        # Convert int16 to WAV bytes (required by OpenAI API)
        int16 = np.clip(audio_int16, -32768, 32767).astype(np.int16)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(int16.tobytes())
        buf.seek(0)
        buf.name = "audio.wav"

        # OpenAI Whisper transcription
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=buf,
            language="zh",           # Chinese (covers Mandarin + Cantonese)
            prompt="以下是粵語對話。" if lang in ("yue","zh-yue","zh-hk") else "",
            response_format="text",
            temperature=0.0,
        )
        return transcript.strip() if transcript else ""
    except Exception as e:
        print(f"[stt-cloud] API error: {e}", flush=True)
        return ""


async def transcribe_async(audio_int16, lang="yue"):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, transcribe_sync, audio_int16, lang)


async def handle(websocket):
    buf = np.array([], dtype=np.int16)
    chunks_received = 0
    lang = "yue"

    print(f"[stt-cloud] connected (yue)", flush=True)
    try:
        async for raw in websocket:
            if isinstance(raw, str):
                try:
                    msg = json.loads(raw)
                    if msg.get("action") == "finalize":
                        if len(buf) >= SAMPLE_RATE // 4:
                            text = await transcribe_async(buf, lang)
                            await websocket.send(json.dumps({"type":"final","text":text} if text else {"type":"final","text":""}))
                        else:
                            await websocket.send(json.dumps({"type":"final","text":""}))
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

            # Transcribe every 2 seconds
            if len(buf) >= SAMPLE_RATE * 2 or chunks_received >= 32:
                if len(buf) >= SAMPLE_RATE // 4:
                    text = await transcribe_async(buf, lang)
                    if text:
                        await websocket.send(json.dumps({"type":"partial","text":text}))
                        print(f"[stt-cloud] → {text}", flush=True)
                buf = np.array([], dtype=np.int16)
                chunks_received = 0

    except Exception as e:
        print(f"[stt-cloud] error: {e}", flush=True)
    finally:
        if len(buf) >= SAMPLE_RATE // 4:
            try:
                text = await transcribe_async(buf, lang)
                if text: await websocket.send(json.dumps({"type":"final","text":text}))
            except Exception: pass
        print(f"[stt-cloud] disconnected", flush=True)


async def main():
    async with serve(handle, "127.0.0.1", PORT, ping_interval=None, ping_timeout=None):
        print(f"[stt-cloud] ready", flush=True)
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    asyncio.run(main())
