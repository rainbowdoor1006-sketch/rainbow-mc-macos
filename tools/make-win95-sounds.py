"""生成两段「Win95 风格」提示音 WAV（合成，不含任何微软素材）。"""
import io
import math
import os
import struct
import sys
import wave

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SR = 44100


def env(t, attack, decay_total):
    if t < 0:
        return 0.0
    if t < attack:
        return t / attack
    return max(0.0, math.exp(-(t - attack) / decay_total))


def render(notes, total):
    n = int(SR * total)
    buf = [0.0] * n
    for f, start, length, amp, kind in notes:
        t0 = int(start * SR)
        cnt = int(length * SR)
        for i in range(cnt):
            idx = t0 + i
            if idx >= n:
                break
            t = i / SR
            e = env(t, 0.02, length / 3.0)
            if kind == "triangle":
                ph = (f * t) % 1.0
                v = 4.0 * abs(ph - 0.5) - 1.0
            else:
                v = math.sin(2 * math.pi * f * t)
            buf[idx] += v * e * amp
    # 归一化 + 轻微软削波
    peak = max(1e-9, max(abs(x) for x in buf))
    if peak > 0.9:
        buf = [x * 0.9 / peak for x in buf]
    return buf


def save(path, buf):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b"".join(struct.pack("<h", int(max(-1, min(1, x)) * 32000)) for x in buf)
        w.writeframes(frames)
    print("已生成", path, round(os.path.getsize(path) / 1024, 1), "KB")


# 开机音：上行琶音（与启动器里 WebAudio 合成一致）
start_notes = [
    (392.00, 0.00, 0.70, 0.18, "triangle"),
    (523.25, 0.13, 0.70, 0.18, "triangle"),
    (659.25, 0.26, 0.70, 0.18, "triangle"),
    (783.99, 0.39, 0.70, 0.18, "triangle"),
    (1046.50, 0.52, 0.90, 0.20, "sine"),
]
# 关机音：两声「噔——噔」
stop_notes = [
    (196.00, 0.00, 0.45, 0.22, "sine"),
    (392.00, 0.00, 0.45, 0.10, "triangle"),
    (146.83, 0.46, 0.85, 0.24, "sine"),
    (293.66, 0.46, 0.85, 0.11, "triangle"),
]

out_dir = r"F:\RAINBOWMC-音效试听"
save(os.path.join(out_dir, "win95-start.wav"), render(start_notes, 1.8))
save(os.path.join(out_dir, "win95-stop.wav"), render(stop_notes, 1.8))

# 同时放进启动器会优先读取的目录
app_dir = r"D:\APP\RAINBOWMC\data\sounds"
save(os.path.join(app_dir, "win95-start.wav"), render(start_notes, 1.8))
save(os.path.join(app_dir, "win95-stop.wav"), render(stop_notes, 1.8))
