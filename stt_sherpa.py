"""
STT Sherpa Server — sherpa-onnx SenseVoice (native Cantonese + Mandarin)
Port 8792. ONNX runtime, fast, no compilation needed.
"""
import asyncio, json, time, numpy as np, sys
from websockets.asyncio.server import serve

PORT = 8792
SAMPLE_RATE = 16000

print("[stt] Loading sherpa-onnx SenseVoice (Cantonese + Mandarin)...", flush=True)

import sherpa_onnx

# SenseVoice Small — multilingual: zh, yue, en, ja, ko
model = sherpa_onnx.OfflineRecognizer.from_sense_voice(
    model="./sense-voice-small-onnx",  # auto-download if needed
    use_itn=True,
)

# Fallback: if model not available locally, use the smallest zipformer
if model is None:
    print("[stt] SenseVoice not found, trying zipformer...", flush=True)
    model = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder="",
        decoder="",
        joiner="",
    )

print(f"[stt] Model loaded. ws://127.0.0.1:{PORT}", flush=True)


def transcribe_sync(audio_f32, sample_rate):
    """Run sherpa-onnx recognition."""
    try:
        stream = model.create_stream()
        stream.accept_waveform(sample_rate, audio_f32)
        model.decode_stream(stream)
        text = stream.result.text.strip()
        return text
    except Exception as e:
        print(f"[stt] error: {e}", flush=True)
        return ""


async def transcribe_async(audio_f32, sample_rate):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, transcribe_sync, audio_f32, sample_rate)


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
                            text = await transcribe_async(buf, SAMPLE_RATE)
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
                    text = await transcribe_async(buf, SAMPLE_RATE)
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
                text = await transcribe_async(buf, SAMPLE_RATE)
                if text: await websocket.send(json.dumps({"type":"final","text":text}))
            except Exception: pass
        print(f"[stt] disconnected", flush=True)


async def main():
    async with serve(handle, "127.0.0.1", PORT, ping_interval=None, ping_timeout=None):
        print(f"[stt] ready", flush=True)
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    asyncio.run(main())
