"""分析 Win95 开机音（mssound.wav）与 tada.wav 的音频结构，输出结构化特征。"""
import io
import sys
import wave

import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def note_name(f):
    if f <= 0:
        return '-'
    n = int(round(69 + 12 * np.log2(f / 440.0)))
    return f"{NOTES[n % 12]}{n // 12 - 1}({f:.1f}Hz)"


def load(path):
    with wave.open(path, 'rb') as w:
        nch, sw, sr, nf = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(nf)
    if sw == 1:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128
    elif sw == 2:
        x = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768
    else:
        x = np.frombuffer(raw, dtype='<i4').astype(np.float32) / 2147483648
    if nch > 1:
        x = x.reshape(-1, nch).mean(axis=1)
    return x, sr, sw * 8, nch


def rms_env(x, sr, win=0.02, hop=0.01):
    w = int(sr * win)
    h = int(sr * hop)
    env = []
    for i in range(0, max(1, len(x) - w), h):
        seg = x[i : i + w]
        env.append(float(np.sqrt(np.mean(seg**2))))
    return np.array(env), hop


def f0_autocorr(seg, sr, fmin=60, fmax=2000):
    seg = seg - seg.mean()
    if np.max(np.abs(seg)) < 1e-4:
        return 0.0
    corr = np.correlate(seg, seg, mode='full')[len(seg) - 1 :]
    lo, hi = int(sr / fmax), min(len(corr) - 2, int(sr / fmin))
    if hi <= lo:
        return 0.0
    k = lo + int(np.argmax(corr[lo:hi]))
    if k <= 0:
        return 0.0
    # 抛物线插值
    if 0 < k < len(corr) - 1:
        a, b, c = corr[k - 1], corr[k], corr[k + 1]
        denom = a - 2 * b + c
        delta = 0.5 * (a - c) / denom if abs(denom) > 1e-12 else 0
    else:
        delta = 0
    return sr / (k + delta)


def analyze(path, label):
    x, sr, bits, nch = load(path)
    dur = len(x) / sr
    print(f"\n=== {label} ===")
    print(f"文件: {path}")
    print(f"时长 {dur:.2f}s · {sr}Hz · {bits}-bit · {nch} 声道 · 峰值 {np.max(np.abs(x)):.2f}")

    env, hop = rms_env(x, sr)
    peak = float(env.max()) if len(env) else 0
    if peak <= 0:
        return
    envn = env / peak

    # 起音点检测（能量从 <0.15 越过 0.3）
    onsets = []
    for i in range(1, len(envn)):
        if envn[i - 1] < 0.15 <= envn[i]:
            onsets.append(i * hop)
    print(f"起音点: {len(onsets)} 个 → " + ", ".join(f"{t:.2f}s" for t in onsets[:12]))

    # 每个起音点后 60ms 窗口估基频
    win = int(sr * 0.06)
    freqs = []
    for t in onsets:
        i = int(t * sr)
        seg = x[i : i + win]
        if len(seg) < win // 2:
            continue
        f = f0_autocorr(seg, sr)
        if f > 0:
            freqs.append((t, f))
    print("主要音高:")
    for t, f in freqs[:12]:
        print(f"   {t:5.2f}s  {note_name(f)}")

    # 亮度（谱质心）
    cents = []
    n = 2048
    for i in range(0, len(x) - n, n):
        seg = x[i : i + n] * np.hanning(n)
        spec = np.abs(np.fft.rfft(seg))
        if spec.sum() < 1e-6:
            continue
        f = np.fft.rfftfreq(n, 1 / sr)
        cents.append(float((spec * f).sum() / spec.sum()))
    if cents:
        print(f"谱质心: 平均 {np.mean(cents):.0f} Hz · 范围 {min(cents):.0f}–{max(cents):.0f} Hz")

    # 包络特征：到达峰值时间、衰减到 50% 时间
    att = int(np.argmax(envn)) * hop
    below = np.where(envn < 0.5)[0]
    print(f"包络: 0.5 峰值出现于 {att:.2f}s · 尾音（RMS<10%）约在 {max(0,(np.where(envn<0.1)[0].max() if len(np.where(envn<0.1)[0]) else len(envn)))*hop:.2f}s")

    # 谐波结构：取能量最大的 100ms 段
    if len(x) > win:
        idx = int(np.argmax(np.convolve(envn, np.ones(5) / 5, mode='same'))) * hop
        i = min(int(idx * sr), max(0, len(x) - n))
        seg = x[i : i + n] * np.hanning(n)
        spec = np.abs(np.fft.rfft(seg))
        f = np.fft.rfftfreq(n, 1 / sr)
        f0 = f0_autocorr(x[int(idx * sr) : int(idx * sr) + win], sr)
        if f0 > 0:
            parts = []
            for h in range(1, 7):
                target = f0 * h
                k = int(np.argmin(np.abs(f - target)))
                lo, hi = max(0, k - 3), min(len(spec), k + 4)
                amp = float(spec[lo:hi].max())
                parts.append(amp)
            if parts[0] > 0:
                print("谐波比例(1~6 次): " + ", ".join(f"{p/parts[0]:.2f}" for p in parts))

    # 静音比例
    print(f"静音占比: {float(np.mean(envn < 0.02))*100:.0f}%")


analyze(r"D:\Temp\win95-sound\mssound.wav", "Windows 95 开机音 (mssound.wav)")
analyze(r"D:\Temp\win95-sound\tada.wav", "Windows 95 tada.wav")
