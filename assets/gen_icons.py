"""生成 PWA 图标：渐变底 + 白色字"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))

C1 = (47, 109, 246)   # #2f6df6
C2 = (122, 79, 240)   # #7a4ff0


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    # 斜向渐变
    for i in range(size * 2):
        t = i / (size * 2 - 1)
        d.line([(i, 0), (0, i)], fill=lerp(C1, C2, t))
    return img


def find_font(size):
    for name in ("msyhbd.ttc", "msyh.ttc", "arialbd.ttf", "segoeuib.ttf"):
        p = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", name)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def make(size, glyph_ratio=0.56, rounded=True, pad=0.0, out="icon.png"):
    base = gradient(size).convert("RGBA")

    if pad > 0:
        # maskable：整块铺满
        draw = ImageDraw.Draw(base)
        pass

    if rounded and pad == 0:
        mask = Image.new("L", (size, size), 0)
        md = ImageDraw.Draw(mask)
        r = int(size * 0.22)
        md.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
        base.putalpha(mask)

    glyph_size = int(size * glyph_ratio)
    font = find_font(glyph_size)
    d = ImageDraw.Draw(base)
    text = "词"

    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1]
    d.text((x, y), text, font=font, fill=(255, 255, 255, 255))

    path = os.path.join(OUT, out)
    base.save(path, "PNG")
    print(f"{out}: {size}x{size}")


make(192, out="icon-192.png")
make(512, out="icon-512.png")
make(180, out="icon-180.png")
make(512, glyph_ratio=0.42, rounded=False, pad=1, out="icon-maskable-512.png")
print("done")
