"""生成两段「有质感」的合成提示音（FM 钟声 + 暖垫 + 低频 + 卷积混响 + 立体声）。

目标：不是"叮咚"两个音，而是像老系统启动音那样有厚度、有余韵。
输出：44.1kHz / 16-bit / 立体声 WAV。
"""
import io
import os
import sys
import wave

import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
SR = 44100


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def bell(freq, dur, amp=0.5, ratio=1.41, index=2.2, decay=1.6, detune=0.0):
    """FM 钟：载波 + 调制器，指数衰减；返回单声道 float 数组"""
    t = t_axis(dur)
    f = freq * (1 + detune)
    mod_env = np.exp(-t / (decay * 0.45))
    mod = np.sin(2 * np.pi * f * ratio * t) * index * mod_env
    car = np.sin(2 * np.pi * f * t + mod)
    # 加两个泛音让钟声更"实"
    car += 0.35 * np.sin(2 * np.pi * f * 2.01 * t) * np.exp(-t / (decay * 0.6))
    car += 0.18 * np.sin(2 * np.pi * f * 3.02 * t) * np.exp(-t / (decay * 0.4))
    env = np.exp(-t / decay) * (1 - np.exp(-t / 0.008))
    return car * env * amp


def pad(freq, dur, amp=0.22, attack=0.35, release=1.2):
    """暖垫：三个微失谐正弦叠成，慢起慢落"""
    t = t_axis(dur)
    v = np.zeros_like(t)
    for det, w in ((-0.004, 1.0), (0.0, 1.0), (0.006, 0.7)):
        v += np.sin(2 * np.pi * freq * (1 + det) * t) * w
    v /= 2.7
    env = np.minimum(1, t / attack) * np.exp(-np.maximum(0, t - dur + release) / (release / 3))
    return v * env * amp


def sub(freq, dur, amp=0.3, decay=0.9):
    t = t_axis(dur)
    return np.sin(2 * np.pi * freq * t) * np.exp(-t / decay) * amp


def thud(dur=0.5, amp=0.35):
    """低频闷响：噪声经衰减 + 快速下滑正弦"""
    t = t_axis(dur)
    noise = np.random.default_rng(7).normal(0, 1, len(t))
    # 一阶低通
    lp = np.zeros_like(noise)
    a = 0.02
    for i in range(1, len(noise)):
        lp[i] = lp[i - 1] + a * (noise[i] - lp[i - 1])
    drop = np.sin(2 * np.pi * (110 * np.exp(-t / 0.08) + 45) * t)
    return (lp * 3.0 + drop * 0.6) * np.exp(-t / (dur * 0.35)) * amp


def reverb(x, wet=0.32, dur=2.2):
    """合成脉冲响应做卷积混响（指数衰减噪声，左右略有差异）"""
    n = int(SR * dur)
    t = np.arange(n) / SR
    rng = np.random.default_rng(11)
    ir_l = rng.normal(0, 1, n) * np.exp(-t / (dur * 0.32))
    ir_r = rng.normal(0, 1, n) * np.exp(-t / (dur * 0.30))
    # 高频衰减更快：简单低通几次
    for _ in range(3):
        ir_l = np.convolve(ir_l, np.array([0.34, 0.33, 0.33]), mode="same")
        ir_r = np.convolve(ir_r, np.array([0.34, 0.33, 0.33]), mode="same")
    ir_l /= np.max(np.abs(ir_l))
    ir_r /= np.max(np.abs(ir_r))
    # FFT 卷积
    N = 1 << int(np.ceil(np.log2(len(x) + n - 1)))
    X = np.fft.rfft(x, N)
    L = np.fft.irfft(X * np.fft.rfft(ir_l, N), N)[: len(x)]
    R = np.fft.irfft(X * np.fft.rfft(ir_r, N), N)[: len(x)]
    # 干声居中，湿声铺开
    dry = np.stack([x, x], axis=1) * (1 - wet)
    wets = np.stack([L, R], axis=1) * wet
    return dry + wets


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[: len(p)] += p
    return out


def save(path, stereo, peak=0.92):
    m = np.max(np.abs(stereo))
    if m > 0:
        stereo = stereo / m * peak
    # 轻微软限幅
    stereo = np.tanh(stereo * 1.15) * 0.92
    pcm = (stereo * 32767).astype("<i2")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"已生成 {path}  {os.path.getsize(path)/1024:.1f} KB  {len(stereo)/SR:.2f}s")


def build_start():
    """开机：低频托底 + 上行钟声琶音 + 暖垫铺满"""
    d = 6.0
    base = mix(
        sub(73.42, d, 0.30, 1.4),          # D2
        pad(146.83, d, 0.16, 0.6, 2.0),    # D3 暖垫
        pad(220.00, d, 0.10, 0.9, 2.2),    # A3
    )
    # 上行琶音（D 大调五声）：钟声逐个进入，尾音重叠
    notes = [(293.66, 0.00), (369.99, 0.28), (440.00, 0.56), (587.33, 0.86), (739.99, 1.18)]
    bells = []
    for f, start in notes:
        b = bell(f, d - start, 0.34, ratio=1.41, index=2.0, decay=2.4)
        b = np.concatenate([np.zeros(int(SR * start)), b[: len(t_axis(d - start))]])
        bells.append(b[: int(SR * d)])
    # 高八度一点"亮点"，很轻
    bells.append(np.concatenate([np.zeros(int(SR * 1.5)), bell(1174.66, 3.0, 0.10, 1.2, 1.6, 1.8)])[: int(SR * d)])
    tone = mix(base, *bells)
    return reverb(tone, wet=0.36, dur=2.6)


def build_stop():
    """关机：两声下沉 + 闷响，尾音拖长"""
    d = 5.0
    thumps = mix(thud(0.6, 0.30), np.concatenate([np.zeros(int(SR * 0.55)), thud(0.9, 0.34)])[: int(SR * d)])
    b1 = bell(196.00, 3.0, 0.30, ratio=1.0, index=1.2, decay=2.0)     # G3
    b1 = np.concatenate([b1, np.zeros(int(SR * 2.0))])[: int(SR * d)]
    b2 = bell(146.83, 3.4, 0.34, ratio=1.0, index=1.1, decay=2.6)     # D3
    b2 = np.concatenate([np.zeros(int(SR * 0.62)), b2])[: int(SR * d)]
    pad_v = pad(98.00, d, 0.14, 0.25, 2.6)                            # G2 底垫
    tone = mix(b1, b2, pad_v, thumps)
    return reverb(tone, wet=0.40, dur=2.4)


if __name__ == "__main__":
    a = build_start()
    b = build_stop()
    for p in (r"D:\APP\RAINBOWMC\data\sounds\win95-start.wav",
              r"F:\RAINBOWMC-音效试听\win95-start-合成增强.wav"):
        save(p, a)
    for p in (r"D:\APP\RAINBOWMC\data\sounds\win95-stop.wav",
              r"F:\RAINBOWMC-音效试听\win95-stop-合成增强.wav"):
        save(p, b)
