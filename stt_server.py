"""
STT WebSocket Server — 跟白龍馬 whisper_server.py 相同做法
Port 8792. int16 PCM 16kHz mono → Whisper base model.
"""
import asyncio, json, time, numpy as np
from concurrent.futures import ThreadPoolExecutor
import whisper
from websockets.asyncio.server import serve

PORT = 8792
SAMPLE_RATE = 16000
CHUNK_SAMPLES = SAMPLE_RATE // 4  # 4000 samples ≈ 250ms
SILENCE_CHUNKS = 4             # ★ 1 秒靜音即觸發（原本 8 個 chunk = 2 秒）
# ★ 提高 VAD 閾值 — 淨係收人聲，唔要電視/背景雜音
SILENCE_RMS = 0.008       # 低於此 = 靜音（提高到 -42dB）
VOICED_RMS = 0.018         # 超過此先算有聲（提高到 -35dB）
MIN_PEAK_RMS = 0.030       # 成段講話峰值必須達此（提高到 -30dB）
MIN_VOICED = 4             # 至少 4 個有聲 chunk（約 1 秒）先觸發

executor = ThreadPoolExecutor(max_workers=2)
model = whisper.load_model("tiny")  # ★ tiny 模型快 4x，近場語音夠用
print(f"[stt] Whisper tiny loaded. ws://127.0.0.1:{PORT}")


def transcribe_sync(audio_int16, lang="zh"):
    """Run whisper in thread. audio_int16 = np.int16 array."""
    audio_f32 = audio_int16.astype(np.float32) / 32768.0
    # 粵語 initial prompt：引導 Whisper 用粵語文字輸出
    prompt = "以下是粵語對話。" if lang in ("yue", "zh-yue", "zh-hk") else "以下是普通話對話。"
    result = model.transcribe(
        audio_f32, language="zh", fp16=False, verbose=False,
        temperature=0.0,
        condition_on_previous_text=False,
        no_speech_threshold=0.6,
        logprob_threshold=-0.8,
        compression_ratio_threshold=2.0,
        initial_prompt=prompt,
    )
    return (result.get("text") or "").strip()


async def transcribe_async(audio_int16):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, transcribe_sync, audio_int16)


async def handle(websocket):
    buf = np.array([], dtype=np.int16)
    silence_count = 0
    voiced_chunks = 0
    utterance_peak = 0.0

    print(f"[stt] connected")
    try:
        async for raw in websocket:
            if isinstance(raw, str):
                try:
                    msg = json.loads(raw)
                    if msg.get("action") == "finalize":
                        if len(buf) >= SAMPLE_RATE // 4 and voiced_chunks >= MIN_VOICED and utterance_peak >= MIN_PEAK_RMS:
                            text = await transcribe_async(buf)
                            if text:
                                await websocket.send(json.dumps({"type": "final", "text": text}))
                            else:
                                await websocket.send(json.dumps({"type": "final", "text": ""}))
                        else:
                            await websocket.send(json.dumps({"type": "final", "text": ""}))
                        buf = np.array([], dtype=np.int16)
                        silence_count = 0
                        voiced_chunks = 0
                        utterance_peak = 0.0
                        await websocket.send(json.dumps({"type": "pong"}))
                except Exception:
                    pass
                continue

            if not isinstance(raw, (bytes, bytearray)):
                continue

            # int16 PCM from browser
            chunk = np.frombuffer(raw, dtype=np.int16)
            rms = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2))) / 32768.0

            buf = np.append(buf, chunk)
            if rms > utterance_peak:
                utterance_peak = rms

            if rms >= VOICED_RMS:
                voiced_chunks += 1
                silence_count = 0
            elif rms < SILENCE_RMS:
                silence_count += 1
            # else: near-silence, don't reset but don't count as voiced

            should_transcribe = False
            if silence_count >= SILENCE_CHUNKS:
                should_transcribe = True
            elif len(buf) >= SAMPLE_RATE * 2:  # ★ 講夠 2 秒即刻轉寫（唔等靜音）
                should_transcribe = True
            elif len(buf) >= SAMPLE_RATE * 25:
                should_transcribe = True

            if should_transcribe:
                if voiced_chunks >= MIN_VOICED and utterance_peak >= MIN_PEAK_RMS:
                    text = await transcribe_async(buf)
                    if text:
                        await websocket.send(json.dumps({"type": "partial", "text": text}))
                        print(f"[stt] → {text}")
                buf = np.array([], dtype=np.int16)
                silence_count = 0
                voiced_chunks = 0
                utterance_peak = 0.0

    except Exception as e:
        print(f"[stt] error: {e}")
    finally:
        if len(buf) >= SAMPLE_RATE // 4 and voiced_chunks >= MIN_VOICED and utterance_peak >= MIN_PEAK_RMS:
            try:
                text = await transcribe_async(buf)
                if text:
                    await websocket.send(json.dumps({"type": "final", "text": text}))
            except Exception:
                pass
        print(f"[stt] disconnected")


async def main():
    async with serve(handle, "127.0.0.1", PORT, ping_interval=None, ping_timeout=None):
        print(f"[stt] ready")
        await asyncio.get_running_loop().create_future()


if __name__ == "__main__":
    asyncio.run(main())
