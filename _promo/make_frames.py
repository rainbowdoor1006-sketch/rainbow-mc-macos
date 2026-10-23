"""生成 RAINBOW MC 宣传视频（苹果风格：深色背景、大字、慢速推近、交叉淡入）。

输出：_promo/frames/*.png → 交给 ffmpeg 编码
"""
import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = r"D:\DeepSeek work\projects\RAINBOW-MC-启动器\_promo"
SHOTS = os.path.join(ROOT, "shots")
FRAMES = os.path.join(ROOT, "frames")
os.makedirs(FRAMES, exist_ok=True)
for f in os.listdir(FRAMES):
    os.remove(os.path.join(FRAMES, f))

W, H = 1920, 1080
FPS = 30
BG_TOP = (16, 19, 22)
BG_BOT = (9, 11, 13)
TEXT = (240, 243, 245)
DIM = (150, 162, 168)
ACCENT = (127, 182, 155)  # 玉青

F_LIGHT = r"C:\Windows\Fonts\msyhl.ttc"
F_REG = r"C:\Windows\Fonts\msyh.ttc"
F_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
F_LATIN_L = r"C:\Windows\Fonts\segoeuil.ttf"

_font_cache = {}


def font(path, size):
    key = (path, size)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(path, size)
    return _font_cache[key]


def bg_layer():
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        r = int(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t)
        g = int(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t)
        b = int(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t)
        for x in range(W):
            px[x, y] = (r, g, b)
    return img


BG = bg_layer()


def text_size(draw, s, f):
    box = draw.textbbox((0, 0), s, font=f)
    return box[2] - box[0], box[3] - box[1], box


def draw_center(draw, s, f, y, color, alpha=255):
    w, h, box = text_size(draw, s, f)
    x = (W - w) // 2 - box[0]
    draw.text((x, y), s, font=f, fill=color + (alpha,))


def rounded(im, radius):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], radius=radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def drop_shadow(size, radius=28, blur=40, alpha=110):
    w, h = size
    sh = Image.new("RGBA", (w + blur * 2, h + blur * 2), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [blur, blur, blur + w, blur + h], radius=radius, fill=(0, 0, 0, alpha)
    )
    return sh.filter(ImageFilter.GaussianBlur(blur * 0.6))


def load_shot(name, target_w, zoom=1.0):
    im = Image.open(os.path.join(SHOTS, name)).convert("RGB")
    # 按目标宽度缩放（保持比例）
    sw = int(im.width * (target_w / im.width) * zoom)
    sh = int(im.height * (target_w / im.width) * zoom)
    im = im.resize((sw, sh), Image.LANCZOS)
    return im


def scene_intro():
    """Logo + 名称"""
    frames = []
    n = int(2.8 * FPS)
    for i in range(n):
        p = i / max(1, n - 1)
        img = BG.copy()
        d = ImageDraw.Draw(img, "RGBA")
        a = int(255 * min(1.0, i / 12.0))
        # 玉青方块 + R
        size = 168
        x0 = (W - size) // 2
        y0 = 360
        d.rounded_rectangle([x0, y0, x0 + size, y0 + size], radius=38, fill=(24, 28, 31, a))
        f_r = font(F_LATIN_L, 108)
        d.text((x0 + 52, y0 + 20), "R", font=f_r, fill=TEXT + (a,))
        d.rounded_rectangle([x0 + 108, y0 + 108, x0 + 140, y0 + 140], radius=4, fill=ACCENT + (a,))
        draw_center(d, "RAINBOW MC", font(F_LIGHT, 74), 600, TEXT, a)
        draw_center(d, "Minecraft 启动器", font(F_REG, 34), 700, DIM, a)
        frames.append(img)
    return frames


def scene_text(big, small=None, hold=2.6):
    frames = []
    n = int(hold * FPS)
    for i in range(n):
        p = i / max(1, n - 1)
        img = BG.copy()
        d = ImageDraw.Draw(img, "RGBA")
        f = min(1.0, i / 10.0, (n - 1 - i) / 10.0)
        a = int(255 * f)
        rise = int((1 - min(1, p * 2.2)) * 18)
        fb = font(F_LIGHT, 66)
        w, h, box = text_size(d, big, fb)
        d.text(((W - w) // 2 - box[0], 470 + rise), big, font=fb, fill=TEXT + (a,))
        if small:
            fs = font(F_REG, 32)
            ws, hs, bs = text_size(d, small, fs)
            d.text(((W - ws) // 2 - bs[0], 590 + rise), small, font=fs, fill=DIM + (a,))
        frames.append(img)
    return frames


def scene_shot(shot, caption, sub=None, zoom_from=1.0, zoom_to=1.035, hold=3.2, panel_w=1440):
    """上方文字 + 下方截图，文字与截图区域严格分离"""
    frames = []
    n = int(hold * FPS)
    cap_y = 176
    sub_y = 268
    shot_top = 396
    for i in range(n):
        p = i / max(1, n - 1)
        img = BG.copy()
        d = ImageDraw.Draw(img, "RGBA")
        f = min(1.0, i / 9.0, (n - 1 - i) / 9.0)
        a = int(255 * f)

        # 文字（左对齐，固定安全边距 200）
        fx = 200
        fc = font(F_LIGHT, 58)
        w, h, box = text_size(d, caption, fc)
        d.text((fx - box[0], cap_y - box[1] + int((1 - min(1, p * 2.5)) * 14)), caption, font=fc, fill=TEXT + (a,))
        if sub:
            fs = font(F_REG, 28)
            ws, hs, bs = text_size(d, sub, fs)
            d.text((fx - bs[0], sub_y - bs[1]), sub, font=fs, fill=DIM + (a,))

        # 截图：按进度缓慢推近
        zoom = zoom_from + (zoom_to - zoom_from) * p
        shot_img = load_shot(shot, panel_w, zoom)
        # 等比裁剪到固定窗口
        win_w, win_h = panel_w, int(panel_w * 9 / 16)
        left = max(0, (shot_img.width - win_w) // 2)
        top = 0
        if shot_img.height < win_h:
            shot_img = shot_img.resize((win_w, win_h), Image.LANCZOS)
            left, top = 0, 0
        crop = shot_img.crop((left, top, left + win_w, top + win_h))
        card = rounded(crop, 18)
        sh = drop_shadow((win_w, win_h))
        cx = (W - win_w) // 2
        img.paste(sh, (cx - 40, shot_top - 40), sh)
        img.paste(card, (cx, shot_top), card)
        # 截图轻微淡入
        if a < 255:
            veil = Image.new("RGBA", img.size, (0, 0, 0, 255 - a))
            img = Image.alpha_composite(img.convert("RGBA"), veil).convert("RGB")
        frames.append(img)
    return frames


def scene_end():
    frames = []
    n = int(3.0 * FPS)
    for i in range(n):
        p = i / max(1, n - 1)
        img = BG.copy()
        d = ImageDraw.Draw(img, "RGBA")
        a = int(255 * min(1.0, i / 12.0))
        size = 132
        x0 = (W - size) // 2
        y0 = 380
        d.rounded_rectangle([x0, y0, x0 + size, y0 + size], radius=30, fill=(24, 28, 31, a))
        f_r = font(F_LATIN_L, 86)
        d.text((x0 + 41, y0 + 15), "R", font=f_r, fill=TEXT + (a,))
        d.rounded_rectangle([x0 + 84, y0 + 84, x0 + 110, y0 + 110], radius=3, fill=ACCENT + (a,))
        draw_center(d, "RAINBOW MC", font(F_LIGHT, 62), 566, TEXT, a)
        draw_center(d, "Windows 10 / 11    免费    下载地址见简介", font(F_REG, 30), 656, DIM, a)
        frames.append(img)
    return frames


def crossfade(a, b, n=12):
    out = []
    for i in range(n):
        t = (i + 1) / (n + 1)
        out.append(Image.blend(a[-1], b[0], t))
    return out


scenes = []
scenes.append(scene_intro())
scenes.append(scene_text("把折腾，交给程序", "装版本、配 Java、补文件、装加载器 —— 全部自动完成"))
scenes.append(scene_shot("01-launch.png", "选版本，点启动", "项目、账号、状态一目了然"))
scenes.append(scene_shot("03-versions.png", "Forge · NeoForge · Fabric · Quilt", "一键安装加载器，自动匹配版本"))
scenes.append(scene_shot("02-mods.png", "内置 Modrinth 资源库", "模组、光影、资源包，搜索即下载"))
scenes.append(scene_shot("04-modpacks.png", "整合包拖进来就能玩", "Modrinth 与 CurseForge 整合包自动补齐模组"))
scenes.append(scene_shot("07-accounts.png", "三种登录方式", "微软正版 / 社团账号 / 离线（无需账号）"))
scenes.append(scene_shot("08-settings.png", "该改的都能改", "下载源、Java、内存、更新通道"))
scenes.append(scene_text("覆盖安装，存档不动", "只替换程序文件，游戏与组件库原地保留"))
scenes.append(scene_text("缺什么，自动补什么", "库文件、游戏资源、Java 运行时"))
scenes.append(scene_end())

idx = 0
prev_last = None
for s in scenes:
    if prev_last is not None:
        for f in crossfade([prev_last], s, 10):
            f.save(os.path.join(FRAMES, f"{idx:05d}.png"))
            idx += 1
    for f in s:
        f.save(os.path.join(FRAMES, f"{idx:05d}.png"))
        idx += 1
    prev_last = s[-1]

print("frames:", idx, "duration:", round(idx / FPS, 1), "s")
