"""钢琴音色合成（参照钢琴的物理特征，不采样）。

钢琴的几个关键特征：
  1. 起音极快（3~8 ms 到峰），带一点"锤击"噪声；
  2. 泛音不是严格整数倍，而是略有拉伸：f_n = n·f0·√(1+B·n²)（B≈0.0004）；
  3. 高次泛音衰减更快，低次泛音延续更久 → 音头亮、尾音暖；
  4. 击弦瞬间高次泛音更强（力度越大越亮），随后迅速变暗；
  5. 同一个音的多根弦有极轻微失谐（拍音），听起来才"厚"。

要求：结尾干脆，不留长尾 → 所有音在结束处做 120 ms 淡出，总线不再加混响尾巴。
"""
import io
import os
import sys
import wave

import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
SR = 44100
NOTES = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def hz(note: str) -> float:
    name, octv = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((NOTES[name] + (octv + 1) * 12 - 69) / 12)


def piano(freq: float, dur: float, vel: float = 0.7, release: float = 0.12) -> np.ndarray:
    n = int(SR * (dur + release))
    tt = np.arange(n) / SR
    B = 0.0004  # 泛音拉伸系数
    out = np.zeros(n, dtype=np.float64)

    # 力度决定最大泛音数与亮度
    max_h = int(min(24, 8 + vel * 14))
    for h in range(1, max_h + 1):
        fh = h * freq * np.sqrt(1 + B * h * h)
        if fh > SR * 0.45:
            break
        # 高次泛音：幅度低、衰减快
        amp = (1.0 / h**1.35) * (0.9 if h > 1 else 1.0) * (0.55 + 0.45 * vel)
        tau = (2.4 / (1 + 0.55 * (h - 1))) * (0.6 + 0.55 * vel)
        # 两根弦微失谐（拍音）
        for det in (-0.0006, 0.0006):
            out += np.sin(2 * np.pi * fh * (1 + det) * tt) * np.exp(-tt / tau) * amp * 0.5

    # 音头：快速上升 + 短促衰减
    atk = 1 - np.exp(-tt / 0.0035)
    body = np.exp(-tt / (1.9 * (0.6 + 0.5 * vel)))
    out *= atk * body

    # 锤击噪声：极短的低通噪声，模拟槌子击弦
    rng = np.random.default_rng(int(freq) % 9991 + 7)
    noise = rng.normal(0, 1, n)
    for _ in range(6):
        noise = np.convolve(noise, np.array([0.25, 0.5, 0.25]), mode="same")
    out += noise * np.exp(-tt / 0.012) * 0.05 * vel

    # 结尾淡出（保证没有余音）
    rel_start = int(SR * dur)
    if rel_start < n:
        fade = np.linspace(1, 0, n - rel_start) ** 1.5
        out[rel_start:] *= fade
    return out


def mix(parts, total: float) -> np.ndarray:
    n = int(SR * total)
    buf = np.zeros(n, dtype=np.float64)
    for sig, at in parts:
        i = int(SR * at)
        if i >= n:
            continue
        room = min(len(sig), n - i)
        buf[i : i + room] += sig[:room]
    return buf


def save(path: str, mono: np.ndarray, peak: float = 0.9) -> None:
    # 轻微立体声（左右微延迟），让钢琴不那么"贴脸"
    d = int(SR * 0.006)
    left = mono
    right = np.concatenate([np.zeros(d), mono[:-d]]) if d < len(mono) else mono
    st = np.stack([left * 0.92 + right * 0.08, right * 0.92 + left * 0.08], axis=1)
    m = np.max(np.abs(st)) or 1
    st = st / m * peak
    st = np.tanh(st * 1.05) * 0.95
    pcm = (st * 32767).astype("<i2")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{path}  {os.path.getsize(path)/1024:.1f} KB  {len(mono)/SR:.2f}s")


def build_start() -> np.ndarray:
    """开机：一个上行钢琴动机（C4-E4-G4-C5），落到 C 大三和弦，收尾干脆。"""
    total = 3.6
    parts = [
        (piano(hz('C4'), 1.9, 0.62), 0.00),
        (piano(hz('E4'), 1.8, 0.66), 0.16),
        (piano(hz('G4'), 1.8, 0.70), 0.32),
        (piano(hz('C5'), 1.9, 0.78), 0.50),
        # 低音支撑
        (piano(hz('C3'), 2.4, 0.55), 0.50),
        # 收尾和弦（轻轻补一层，短促）
        (piano(hz('E5'), 0.9, 0.45), 1.90),
        (piano(hz('G5'), 0.85, 0.38), 1.98),
    ]
    return mix(parts, total)


def build_stop() -> np.ndarray:
    """关机：下行钢琴（C5-G4-E4-C4），最后一击明确收住，不留尾音。"""
    total = 2.6
    parts = [
        (piano(hz('C5'), 0.9, 0.70), 0.00),
        (piano(hz('G4'), 0.9, 0.68), 0.28),
        (piano(hz('E4'), 0.9, 0.66), 0.56),
        (piano(hz('C4'), 1.4, 0.80), 0.86),
        (piano(hz('C3'), 1.2, 0.60), 0.90),
    ]
    return mix(parts, total)


if __name__ == "__main__":
    a = build_start()
    b = build_stop()
    save(r"D:\APP\RAINBOWMC\data\sounds\win95-start.wav", a)
    save(r"D:\APP\RAINBOWMC\data\sounds\win95-stop.wav", b)
    save(r"F:\RAINBOWMC-音效试听\win95-start-钢琴.wav", a)
    save(r"F:\RAINBOWMC-音效试听\win95-stop-钢琴.wav", b)
