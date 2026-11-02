"""生成「液态玻璃」背景板（强化版）：明显的色块折射 + 斜向高光 + 磨砂颗粒。"""
import io
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

OUT_DIR = r"D:\DeepSeek work\projects\RAINBOW-MC-启动器\docs\images"
os.makedirs(OUT_DIR, exist_ok=True)


def make_glass(w, h, radius, out, white_veil=0.42, blob_alpha=120):
    # 1) 冷白薄荷底
    base = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(base)
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(240 - 12 * t)
        g = int(250 - 6 * t)
        b = int(247 - 2 * t)
        d.line([(0, y), (w, y)], fill=(r, g, b))

    # 2) 液态色块（玻璃后的颜色）
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    blobs = [
        (0.12, 0.06, 0.46, (96, 220, 186)),
        (0.92, 0.18, 0.44, (120, 176, 255)),
        (0.22, 0.46, 0.40, (150, 240, 210)),
        (0.80, 0.62, 0.46, (110, 196, 252)),
        (0.40, 0.86, 0.42, (130, 236, 200)),
        (0.62, 0.30, 0.30, (190, 235, 255)),
    ]
    for cx, cy, rad, color in blobs:
        x, y = int(cx * w), int(cy * h)
        r = int(rad * min(w, h) * 1.15)
        ld.ellipse([x - r, y - r, x + r, y + r], fill=color + (blob_alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(int(min(w, h) * 0.16)))
    base = Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB")

    # 3) 白色薄雾（保证黑色文字可读）
    veil = Image.new("RGB", (w, h), (255, 255, 255))
    base = Image.blend(base, veil, white_veil)

    # 4) 斜向高光条（玻璃的“液态”感）
    streak = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(streak)
    for k, (off, width, alpha) in enumerate([(0.05, 0.06, 120), (0.22, 0.035, 90), (0.55, 0.05, 70), (0.78, 0.03, 60)]):
        x0 = int(off * w)
        pts = [(x0, 0), (x0 + int(width * w), 0), (x0 + int(width * w) + int(0.35 * w), h), (x0 + int(0.35 * w), h)]
        sd.polygon(pts, fill=alpha)
    streak = streak.filter(ImageFilter.GaussianBlur(int(w * 0.03)))
    white = Image.new("RGB", (w, h), (255, 255, 255))
    base = Image.composite(white, base, streak)

    # 5) 底部内阴影（玻璃厚度）
    shadow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(shadow).ellipse([int(-0.2 * w), int(0.86 * h), int(1.2 * w), int(1.5 * h)], fill=90)
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(h * 0.08)))
    dark = Image.new("RGB", (w, h), (190, 210, 214))
    base = Image.composite(dark, base, shadow.point(lambda v: int(v * 0.5)))

    # 6) 磨砂颗粒
    noise = Image.new("L", (w, h))
    rnd = random.Random(11)
    px = noise.load()
    for yy in range(h):
        v = 128
        for xx in range(0, w, 2):
            if xx % 2 == 0:
                v = 128 + rnd.randint(-9, 9)
            px[xx, yy] = v
            if xx + 1 < w:
                px[xx + 1, yy] = v
    noise = noise.filter(ImageFilter.GaussianBlur(0.8))
    grain = Image.merge("RGB", (noise, noise, noise))
    base = Image.blend(base, grain, 0.05)

    # 7) 圆角 + 亮边
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(base, (0, 0), mask)

    edge = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, outline=(255, 255, 255, 245), width=4)
    ed.rounded_rectangle([8, 8, w - 9, h - 9], radius=max(6, radius - 8), outline=(255, 255, 255, 110), width=2)
    canvas = Image.alpha_composite(canvas, edge)

    path = os.path.join(OUT_DIR, out)
    canvas.convert("RGB").save(path, "PNG", optimize=True)
    return path


for args in [
    (1200, 2600, 60, "glass-card.png"),
    (1200, 900, 44, "glass-hero.png"),
]:
    p = make_glass(*args)
    print(os.path.basename(p), round(os.path.getsize(p) / 1024, 1), "KB")
