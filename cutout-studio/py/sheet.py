"""Contact sheet of cut pieces on green, numbered, so a person or a vision model can identify them.

Usage: python sheet.py out.jpg piece1.png piece2.png ...
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

out, files = sys.argv[1], sys.argv[2:]
cell, cols = 260, 6
rows = max(1, (len(files) + cols - 1) // cols)
S = Image.new("RGB", (cols * cell, rows * (cell + 28)), (60, 140, 90))
d = ImageDraw.Draw(S)
try:
    font = ImageFont.load_default(size=18)
except TypeError:
    font = ImageFont.load_default()
for i, f in enumerate(files):
    im = Image.open(f).convert("RGBA")
    im.thumbnail((cell - 10, cell - 10))
    x, y = (i % cols) * cell, (i // cols) * (cell + 28)
    S.paste(im, (x + 5 + (cell - 10 - im.width) // 2, y + 5 + (cell - 10 - im.height) // 2), im)
    d.text((x + 6, y + cell + 2), f"{i + 1}. {os.path.splitext(os.path.basename(f))[0]}", fill=(255, 255, 255), font=font)
S.save(out, quality=88)
