"""
STT Watchdog — keep stt_server.py alive on port 8792.
Auto-restarts if it crashes. Check every 30s.
"""
import subprocess, time, sys, os

SERVER_SCRIPT = r"C:\Users\guohu\hermes-webui\stt_server.py"
PYTHON = r"C:\Users\guohu\AppData\Local\Python\pythoncore-3.14-64\python.exe"
CHECK_INTERVAL = 30

os.environ["PYTHONUNBUFFERED"] = "1"

def is_alive():
    import socket
    try:
        s = socket.create_connection(("127.0.0.1", 8792), timeout=3)
        s.close()
        return True
    except Exception:
        return False

print(f"[stt-watchdog] Starting STT server monitor...")
proc = None

while True:
    if proc is None or proc.poll() is not None:
        if proc:
            print(f"[stt-watchdog] STT server died (exit {proc.returncode}), restarting...")
        else:
            print(f"[stt-watchdog] Starting STT server...")

        proc = subprocess.Popen(
            [PYTHON, "-u", SERVER_SCRIPT],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Wait for Whisper model to load
        for _ in range(20):
            time.sleep(1)
            if is_alive():
                print(f"[stt-watchdog] STT server ready (PID {proc.pid})")
                break
        else:
            print(f"[stt-watchdog] STT server still loading...")

    time.sleep(CHECK_INTERVAL)
