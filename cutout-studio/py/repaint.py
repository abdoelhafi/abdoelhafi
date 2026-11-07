"""Repaint Gemini's brick-red 'shadow skin' on a hand/leg piece with the real skin colour.

Usage: python repaint.py --piece hand.png [--ref head.png] [--out fixed.png]
Pixels with R>140, G<120, B<100, R-G>60 are replaced by the median skin colour,
scaled by luminance so the shading survives.
"""
import argparse, json, sys
import cv2
import numpy as np


def skin_colour(rgba):
    a = rgba[..., 3] > 200
    hsv = cv2.cvtColor(rgba[..., :3], cv2.COLOR_BGR2HSV).astype(np.int16)
    hch, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    b, g, r = [rgba[..., i].astype(np.int16) for i in range(3)]
    red = (r > 140) & (g < 120) & (b < 100) & (r - g > 60)
    skin = a & (hch >= 4) & (hch <= 22) & (s > 40) & (s < 170) & (v > 110) & ~red
    if skin.sum() < 50:
        return None
    return np.median(rgba[..., :3][skin], 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--piece", required=True)
    ap.add_argument("--ref")
    ap.add_argument("--out")
    ap.add_argument("--colour", help="hex skin colour, e.g. #E8B48F")
    a = ap.parse_args()
    img = cv2.imread(a.piece, cv2.IMREAD_UNCHANGED)
    if img is None or img.shape[2] != 4:
        print(json.dumps({"ok": False, "error": "piece must be a transparent PNG"}))
        return
    if a.colour:
        hx = a.colour.lstrip("#")
        col = np.array([int(hx[4:6], 16), int(hx[2:4], 16), int(hx[0:2], 16)], np.float32)
    else:
        col = None
        if a.ref:
            ref = cv2.imread(a.ref, cv2.IMREAD_UNCHANGED)
            if ref is not None and ref.shape[2] == 4:
                col = skin_colour(ref)
        if col is None:
            col = skin_colour(img)
        if col is None:
            col = np.array([143, 180, 232], np.float32)  # BGR of a warm light skin tone
    b, g, r = [img[..., i].astype(np.int16) for i in range(3)]
    red = (r > 140) & (g < 120) & (b < 100) & (r - g > 60) & (img[..., 3] > 0)
    n = int(red.sum())
    if n:
        lum = img[..., :3].astype(np.float32).mean(2)
        ref_l = float(np.median(lum[red])) or 1.0
        scale = np.clip(lum / ref_l, 0.6, 1.25)[..., None]
        img[..., :3][red] = np.clip(col[None, :] * scale[red], 0, 255).astype(np.uint8)
    cv2.imwrite(a.out or a.piece, img)
    print(json.dumps({"ok": True, "pixels": n, "colour": "#%02X%02X%02X" % (int(col[2]), int(col[1]), int(col[0]))}))


if __name__ == "__main__":
    main()
