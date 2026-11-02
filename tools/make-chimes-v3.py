"""按实测特征合成两段提示音。

实测结论（mssound.wav / tada.wav）：
  · 开机音：C 大调铺底（E3/C4/F4/A#4 一带）+ 高频闪烁（G5/B5/C6/G7），
    起音是 1 秒左右的"渐强"，谱亮度从 770Hz 一路涨到 1600~2000Hz，
    尾巴 1 秒左右（混响）→ 6.1 秒结束。整体是"缓慢变亮的长音"。
  · tada：C 大调跨八度和弦（G4/C5/E5/G5/C6 + 开头 G7 闪烁），
    起音极快（0.07 秒到半峰），亮度 3100Hz 起、一秒内衰减到 1900Hz。

本脚本照着这两个特征合成，不采样任何原始素材。
"""
import io
import os
import sys
import wave

import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
SR = 44100


def t(dur):
    return np.arange(int(SR * dur)) / SR


def hz(note):
    """音名 → 频率，如 'C4'"""
    names = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
    n, octv = note[:-1], int(note[-1])
    semis = names[n] + (octv + 1) * 12
    return 440.0 * 2 ** ((semis - 69) / 12)


def add_layer(dst, src, at):
    i = int(SR * at)
    if i >= len(dst):
        return dst
    room = len(dst) - i
    dst[i:] += src[:room]
    return dst


def pad_note(freq, dur, amp=0.2, attack=0.9, decay=None, bright=0.4):
    """长音铺底：基频 + 2/3/4 次泛音，泛音随时间"打开"（模拟变亮）"""
    tt = t(dur)
    base = np.sin(2 * np.pi * freq * tt)
    # 泛音分两层：早期弱、后期强 → 亮度上升
    early = 1.0 - np.exp(-tt / (attack * 0.5))
    late = 1.0 - np.exp(-tt / (dur * 0.55))
    v = base * 1.0
    for h, w in ((2, 0.45), (3, 0.28), (4, 0.18), (5, 0.10)):
        v += np.sin(2 * np.pi * freq * h * tt) * w * (early * (1 - bright) + late * bright)
    env = np.minimum(1.0, tt / attack)
    if decay:
        env *= np.exp(-np.maximum(0, tt - dur * 0.65) / decay)
    return v * env * amp / 1.9


def shimmer(freq, dur, amp=0.06, decay=0.9):
    """高频闪烁：FM 小钟"""
    tt = t(dur)
    mod = np.sin(2 * np.pi * freq * 1.5 * tt) * 1.2 * np.exp(-tt / (decay * 0.3))
    v = np.sin(2 * np.pi * freq * tt + mod)
    v += 0.3 * np.sin(2 * np.pi * freq * 2.01 * tt)
    return v * np.exp(-tt / decay) * amp


def bell(freq, dur, amp=0.3, decay=1.6):
    tt = t(dur)
    v = np.sin(2 * np.pi * freq * tt)
    v += 0.5 * np.sin(2 * np.pi * freq * 2.0 * tt) * np.exp(-tt / (decay * 0.7))
    v += 0.25 * np.sin(2 * np.pi * freq * 3.0 * tt) * np.exp(-tt / (decay * 0.45))
    return v * np.exp(-tt / decay) * (1 - np.exp(-tt / 0.006)) * amp


def reverb(x, wet=0.35, dur=2.4):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    rng = np.random.default_rng(3)
    l = rng.normal(0, 1, n) * np.exp(-tt / (dur * 0.34))
    r = rng.normal(0, 1, n) * np.exp(-tt / (dur * 0.32))
    for _ in range(4):
        k = np.array([0.3, 0.4, 0.3])
        l = np.convolve(l, k, mode="same")
        r = np.convolve(r, k, mode="same")
    l /= np.max(np.abs(l)) or 1
    r /= np.max(np.abs(r)) or 1
    N = 1 << int(np.ceil(np.log2(len(x) + n - 1)))
    X = np.fft.rfft(x, N)
    L = np.fft.irfft(X * np.fft.rfft(l, N), N)[: len(x)]
    R = np.fft.irfft(X * np.fft.rfft(r, N), N)[: len(x)]
    return np.stack([x * (1 - wet) + L * wet, x * (1 - wet) + R * wet], axis=1)


def save(path, sig, peak=0.9):
    m = np.max(np.abs(sig)) or 1
    sig = sig / m * peak
    sig = np.tanh(sig * 1.2) * 0.9
    pcm = (sig * 32767).astype("<i2")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{path}  {os.path.getsize(path)/1024:.1f} KB  {len(sig)/SR:.2f}s")


def build_start():
    D = 6.1
    out = np.zeros(int(SR * D))
    # 1) 低频铺底：C3/E3（对应实测里 E3/C4 的低频簇）
    add_layer(out, pad_note(hz('C3'), 5.4, 0.24, attack=1.0, decay=0.8, bright=0.45), 0.0)
    add_layer(out, pad_note(hz('E3'), 5.2, 0.18, attack=1.1, decay=0.9, bright=0.5), 0.15)
    # 2) 中频三和弦：C4/E4/G4 依次进入（像和声慢慢堆起来）
    add_layer(out, pad_note(hz('C4'), 4.8, 0.16, attack=1.0, decay=1.0, bright=0.55), 0.30)
    add_layer(out, pad_note(hz('E4'), 4.4, 0.13, attack=1.1, decay=1.0, bright=0.6), 0.85)
    add_layer(out, pad_note(hz('G4'), 4.0, 0.11, attack=1.2, decay=1.0, bright=0.65), 1.35)
    # 3) 高频闪烁（实测里 G5/B5/C6/G7 那些"亮片"），越到后面越多
    for f, at, amp in [(hz('G5'), 1.0, 0.07), (hz('C6'), 1.9, 0.06), (hz('B5'), 2.7, 0.05),
                       (hz('G6'), 3.3, 0.04), (hz('C7'), 4.0, 0.03)]:
        add_layer(out, shimmer(f, D - at - 0.1, amp, decay=1.1), at)
    return reverb(out, wet=0.38, dur=2.4)


def build_stop():
    D = 5.0
    out = np.zeros(int(SR * D))
    # 开头一闪（对应 tada 那个 G7）
    add_layer(out, shimmer(hz('G7'), 0.8, 0.05, decay=0.5), 0.0)
    # 下沉和弦：C5 → G4 → E4 → C4，每个都留长尾
    for note, at, amp in [('C5', 0.00, 0.16), ('G4', 0.45, 0.18), ('E4', 0.95, 0.20), ('C4', 1.55, 0.20)]:
        add_layer(out, bell(hz(note), D - at - 0.2, amp, decay=1.9), at)
    # 低音收尾
    add_layer(out, pad_note(hz('C3'), 3.2, 0.22, attack=0.4, decay=1.2, bright=0.25), 1.5)
    return reverb(out, wet=0.42, dur=2.6)


if __name__ == "__main__":
    save(r"D:\APP\RAINBOWMC\data\sounds\win95-start.wav", build_start())
    save(r"D:\APP\RAINBOWMC\data\sounds\win95-stop.wav", build_stop())
    save(r"F:\RAINBOWMC-音效试听\win95-start-特征合成.wav", build_start())
    save(r"F:\RAINBOWMC-音效试听\win95-stop-特征合成.wav", build_stop())
