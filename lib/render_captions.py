#!/usr/bin/env python3
"""Renders reel captions to transparent full-canvas PNGs for ffmpeg overlay.

Usage: python3 render_captions.py /abs/path/captions-spec.json
Spec: { width, height, position, fontPx, items: [{ file, text }] }
Each PNG is written next to the spec file.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def wrap(draw, text, font, max_w):
    words = text.split()
    lines = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= max_w or not current:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def main():
    if len(sys.argv) < 2:
        print("spec path required", file=sys.stderr)
        sys.exit(2)
    spec_path = sys.argv[1]
    with open(spec_path, "r", encoding="utf-8") as fh:
        spec = json.load(fh)

    width = int(spec.get("width", 1080))
    height = int(spec.get("height", 1920))
    position = spec.get("position", "bottom")
    font = load_font(int(spec.get("fontPx", 68)))
    base_dir = os.path.dirname(os.path.abspath(spec_path))

    for item in spec.get("items", []):
        text = str(item.get("text", "")).strip().upper()
        if not text:
            continue
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        lines = wrap(draw, text, font, width - 140)
        ascent, descent = font.getmetrics()
        line_height = int((ascent + descent) * 1.18)
        total_height = line_height * len(lines)
        if position == "top":
            y0 = 240
        elif position == "center":
            y0 = (height - total_height) // 2
        else:
            y0 = height - 260 - total_height
        for i, line in enumerate(lines):
            line_w = draw.textlength(line, font=font)
            x = (width - line_w) // 2
            y = y0 + i * line_height
            draw.text(
                (x, y),
                line,
                font=font,
                fill=(255, 255, 255, 255),
                stroke_width=7,
                stroke_fill=(0, 0, 0, 235),
            )
        img.save(os.path.join(base_dir, item["file"]))

    print("OK")


if __name__ == "__main__":
    main()
