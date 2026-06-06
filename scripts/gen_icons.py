#!/usr/bin/env python3
"""Generate the Tauri icon set from a procedural design.

Outputs (under src-tauri/icons/):
  - 32x32.png
  - 128x128.png
  - 128x128@2x.png  (256px)
  - icon.png        (512px master)
  - icon.icns       (macOS, stitched from PNG sizes)
  - icon.ico        (Windows, multi-resolution)

The icon is a stylised stacked tower, drawn entirely with PIL primitives so
the build needs no external image assets.
"""

import os
import struct
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Rounded background
    pad = int(size * 0.04)
    radius = int(size * 0.20)
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=radius, fill=(29, 158, 117, 255))

    # Soft inner highlight
    highlight = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    hd.rounded_rectangle(
        [pad + 2, pad + 2, size - pad - 2, int(size * 0.45)],
        radius=radius,
        fill=(255, 255, 255, 30),
    )
    highlight = highlight.filter(ImageFilter.GaussianBlur(radius=size * 0.02))
    img = Image.alpha_composite(img, highlight)
    d = ImageDraw.Draw(img)

    # Tower blocks (4 stacked)
    cx = size // 2
    blocks = [
        # (width%, height%, y%, fill)
        (0.55, 0.10, 0.78, (224, 219, 195, 255)),
        (0.65, 0.10, 0.65, (159, 225, 203, 255)),
        (0.45, 0.10, 0.52, (255, 255, 255, 255)),
        (0.40, 0.10, 0.39, (225, 245, 238, 255)),
    ]
    for i, (w_pct, h_pct, y_pct, color) in enumerate(blocks):
        w = int(size * w_pct)
        h = int(size * h_pct)
        cy = int(size * y_pct)
        # slight wobble
        offset = int(size * 0.01 * (1 if i % 2 else -1))
        x0 = cx - w // 2 + offset
        y0 = cy
        d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=int(size * 0.012), fill=color)
        d.rectangle([x0, y0, x0 + w, y0 + 2], fill=(0, 0, 0, 35))  # top shadow

    # Stand shadow under tower
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sw = int(size * 0.55)
    sh = int(size * 0.04)
    sx = cx - sw // 2
    sy = int(size * 0.86)
    sd.ellipse([sx, sy, sx + sw, sy + sh], fill=(0, 0, 0, 80))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=size * 0.012))
    img = Image.alpha_composite(img, shadow)

    # Foreground card pip in corner
    d = ImageDraw.Draw(img)
    cr = int(size * 0.075)
    cxx = int(size * 0.82)
    cyy = int(size * 0.20)
    d.ellipse([cxx - cr, cyy - cr, cxx + cr, cyy + cr], fill=(255, 255, 255, 255))
    d.text((cxx - cr * 0.42, cyy - cr * 0.78), "+", fill=(29, 158, 117, 255))

    return img


def save_png(img: Image.Image, path: Path):
    img.save(path, "PNG", optimize=True)


def write_icns(path: Path, sources: dict[int, Image.Image]):
    # Minimal ICNS encoder. Each entry: 4-byte OSType + 4-byte big-endian
    # length (incl header) + PNG bytes. Supported icon types here:
    #   ic07: 128x128, ic08: 256x256, ic09: 512x512, ic13: 256x256@2x (=512),
    #   ic14: 512x512@2x (=1024). We use 128 + 256 + 512 which is plenty.
    type_map = {
        128: b"ic07",
        256: b"ic08",
        512: b"ic09",
    }
    chunks = []
    for size, ostype in type_map.items():
        if size in sources:
            buf = io_png_bytes(sources[size])
            chunks.append(ostype + struct.pack(">I", len(buf) + 8) + buf)
    body = b"".join(chunks)
    header = b"icns" + struct.pack(">I", len(body) + 8)
    path.write_bytes(header + body)


def io_png_bytes(img: Image.Image) -> bytes:
    from io import BytesIO

    bio = BytesIO()
    img.save(bio, "PNG", optimize=True)
    return bio.getvalue()


def write_ico(path: Path, sources: dict[int, Image.Image]):
    # Use PIL's built-in ICO writer with our preferred sizes.
    master = sources[256] if 256 in sources else max(sources.values(), key=lambda im: im.size[0])
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(path, format="ICO", sizes=sizes)
    _ = zlib  # silence unused import warning when ico path is taken


def main():
    masters = {sz: draw_icon(sz) for sz in (32, 64, 128, 256, 512)}
    save_png(masters[32], OUT / "32x32.png")
    save_png(masters[128], OUT / "128x128.png")
    save_png(masters[256], OUT / "128x128@2x.png")  # Tauri's "@2x" of 128
    save_png(masters[512], OUT / "icon.png")
    write_icns(OUT / "icon.icns", {128: masters[128], 256: masters[256], 512: masters[512]})
    write_ico(OUT / "icon.ico", masters)
    # Windows store + Steam square assets
    save_png(masters[256], OUT / "Square71x71Logo.png")
    save_png(masters[256], OUT / "Square150x150Logo.png")
    save_png(masters[512], OUT / "StoreLogo.png")
    print(f"Wrote icons to {OUT}")


if __name__ == "__main__":
    main()
