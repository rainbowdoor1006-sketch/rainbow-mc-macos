"""细化分析：每 0.25 秒给出主要频率成分（峰值）+ 亮度 + 能量，用于描述结构。"""
import io
import sys
import wave

import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def nn(f):
    if f <= 20:
        return '-'
    n = int(round(69 + 12 * np.log2(f / 440.0)))
    return f"{NOTES[n % 12]}{n // 12 - 1}"


def load(path):
    with wave.open(path, 'rb') as w:
        nch, sw, sr, nf = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(nf)
    x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128 if sw == 1 else np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768
    if nch > 1:
        x = x.reshape(-1, nch).mean(axis=1)
    return x, sr


def peaks(seg, sr, n=3, fmin=60, fmax=6000):
    w = seg * np.hanning(len(seg))
    spec = np.abs(np.fft.rfft(w))
    f = np.fft.rfftfreq(len(seg), 1 / sr)
    idx = np.where((f >= fmin) & (f <= fmax))[0]
    s = spec[idx]
    out = []
    for _ in range(n):
        if not len(s):
            break
        k = int(np.argmax(s))
        out.append(float(f[idx[k]]))
        s[max(0, k - 6) : k + 7] = 0
    return out


def table(path, label, step=0.25):
    x, sr = load(path)
    dur = len(x) / sr
    print(f"\n### {label}（{dur:.2f}s, {sr}Hz）")
    print("时间     能量   亮度Hz   主成分(前3)")
    n = int(sr * 0.09)
    for t in np.arange(0, dur, step):
        i = int(t * sr)
        seg = x[i : i + n]
        if len(seg) < n // 2:
            break
        rms = float(np.sqrt(np.mean(seg**2)))
        if rms < 0.02:
            print(f"{t:5.2f}s   {rms:5.3f}   -        （静音/弱）")
            continue
        w = seg * np.hanning(len(seg))
        spec = np.abs(np.fft.rfft(w))
        f = np.fft.rfftfreq(len(seg), 1 / sr)
        centroid = float((spec * f).sum() / max(1e-9, spec.sum()))
        ps = peaks(seg, sr, 3)
        print(f"{t:5.2f}s   {rms:5.3f}   {centroid:6.0f}   " + "  ".join(f"{nn(p)}/{p:.0f}" for p in ps))


table(r"D:\Temp\win95-sound\mssound.wav", "Win95 开机音 mssound.wav")
table(r"D:\Temp\win95-sound\tada.wav", "Win95 tada.wav", step=0.15)
