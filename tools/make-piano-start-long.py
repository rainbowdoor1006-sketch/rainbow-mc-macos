"""加长版钢琴开机音（只改开机音，关机音保持原样）。

注意：不要在这里再包装 sys.stdout —— 被导入的脚本自己会包装，重复包装会把缓冲区关掉。
"""
import importlib.util

import numpy as np

BASE = r"D:\DeepSeek work\projects\RAINBOW-MC-启动器\tools\make-piano-chimes.py"
spec = importlib.util.spec_from_file_location("chimes", BASE)
chimes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(chimes)

hz = chimes.hz
piano = chimes.piano
mix = chimes.mix
save = chimes.save


def build_start_long() -> np.ndarray:
    """6.6 秒：C → Am → F → G 的钢琴进行，最后落在 C 大三和弦。"""
    total = 6.6
    parts = []

    def chord(notes, at, dur, vel, gap=0.0):
        for i, n in enumerate(notes):
            parts.append((piano(hz(n), dur, vel), at + i * gap))

    chord(['C3'], 0.00, 2.6, 0.52)
    chord(['C4', 'E4', 'G4', 'C5'], 0.00, 2.2, 0.62, gap=0.14)
    chord(['A2'], 1.55, 2.4, 0.50)
    chord(['A3', 'C4', 'E4', 'A4'], 1.55, 2.0, 0.56, gap=0.14)
    chord(['F2'], 3.05, 2.4, 0.50)
    chord(['F3', 'A3', 'C4', 'F4'], 3.05, 2.0, 0.58, gap=0.14)
    chord(['G2'], 4.45, 1.6, 0.50)
    chord(['G3', 'B3', 'D4', 'G4'], 4.45, 1.4, 0.58, gap=0.12)
    chord(['C3'], 5.35, 1.15, 0.55)
    chord(['C4', 'E4', 'G4', 'C5'], 5.35, 1.05, 0.66, gap=0.05)
    parts.append((piano(hz('C6'), 0.9, 0.34), 5.55))
    parts.append((piano(hz('E6'), 0.8, 0.26), 5.72))

    return mix(parts, total)


if __name__ == '__main__':
    sig = build_start_long()
    save(r'D:\APP\RAINBOWMC\data\sounds\win95-start.wav', sig)
    save(r'F:\RAINBOWMC-音效试听\win95-start-钢琴加长.wav', sig)
