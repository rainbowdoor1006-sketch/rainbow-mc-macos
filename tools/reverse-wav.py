"""倒放任意位深的 WAV（支持 8/16/24/32-bit）。"""
import io
import os
import sys
import wave

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

src, dst = sys.argv[1], sys.argv[2]

with wave.open(src, "rb") as w:
    nch, sw, sr, nf = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    frames = w.readframes(nf)

# 按"每帧字节数"整帧反转，保证声道不乱
frame_bytes = sw * nch
n = len(frames) // frame_bytes
chunks = [frames[i * frame_bytes : (i + 1) * frame_bytes] for i in range(n)]
chunks.reverse()
out = b"".join(chunks)

with wave.open(dst, "wb") as w:
    w.setnchannels(nch)
    w.setsampwidth(sw)
    w.setframerate(sr)
    w.writeframes(out)

print(f"原音: {nf / sr:.2f} 秒, {sr} Hz, {nch} 声道, {sw * 8}-bit")
print("已生成:", dst, round(os.path.getsize(dst) / 1024, 1), "KB")
