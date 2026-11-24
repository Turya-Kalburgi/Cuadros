import json, os, sys
from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def wrap(draw, text, font, max_width):
    lines = []
    current = ""
    for word in text.split():
        trial = f"{current} {word}".strip()
        if not current or draw.textlength(trial, font=font) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def main():
    with open(sys.argv[1], encoding="utf8") as handle:
        spec = json.load(handle)
    width = int(spec["width"])
    height = int(spec["height"])
    for item in spec["items"]:
        style = item.get("style", "stamp")
        size = 42 if style == "hook" else 26
        font = ImageFont.truetype(FONT, size)
        image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        text = item["text"].upper() if style == "hook" else item["text"]
        lines = wrap(draw, text, font, int(width * 0.86))
        line_height = int(size * 1.3)
        block_height = line_height * len(lines)
        if style == "hook":
            y = int(height * 0.18)
            stroke = 4
        else:
            y = max(int(height * 0.06), height - int(height * 0.12) - block_height)
            stroke = 3
        for index, line in enumerate(lines):
            if style == "hook":
                draw.text(
                    (width // 2, y + index * line_height),
                    line,
                    font=font,
                    fill=(255, 255, 255, 255),
                    stroke_width=stroke,
                    stroke_fill=(0, 0, 0, 235),
                    anchor="mm",
                )
            else:
                draw.text(
                    (int(width * 0.07), y + index * line_height),
                    line,
                    font=font,
                    fill=(255, 255, 255, 255),
                    stroke_width=stroke,
                    stroke_fill=(0, 0, 0, 225),
                    anchor="la",
                )
        image.save(os.path.join(spec["outDir"], item["file"]))


main()
