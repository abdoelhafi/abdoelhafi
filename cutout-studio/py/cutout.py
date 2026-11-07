"""Cut a Gemini image into transparent pieces and check it for known Gemini defects.

Usage:
  python cutout.py --src img.jpg --out DIR --name exec --kind split --expect 8 [--method auto|grey|distance] [--threshold 30]
  python cutout.py --src bg.jpg --out DIR --name bg_office --kind background

Prints one JSON object: {"pieces": [...], "checks": [...], "info": {...}}
kinds: character (one full figure), split (character in pieces), object, objects (several), background
"""
import argparse, json, os, sys
import cv2
import numpy as np


def check(level, code, message, **kw):
    return {"level": level, "code": code, "message": message, **kw}


def corner_stats(f):
    s = 24
    corners = [f[:s, :s], f[:s, -s:], f[-s:, :s], f[-s:, -s:]]
    pts = np.concatenate([c.reshape(-1, 3) for c in corners])
    return np.median(pts, 0), np.array([c.reshape(-1, 3).std(0).mean() for c in corners]), [np.median(c.reshape(-1, 3), 0) for c in corners]


def background_mask(img, method, thr):
    f = img.astype(np.float32)
    sat = f.max(2) - f.min(2)
    val = f.max(2)
    if method == "grey":  # original cut.py: low-saturation mid/light grey
        cand = (sat < 22) & (val > 110) & (val < 232)
    else:  # cut2.py: distance to the median corner colour
        bgc, _, _ = corner_stats(f)
        d = np.sqrt(((f - bgc) ** 2).sum(2))
        bg_sat = float(bgc.max() - bgc.min())
        cand = (d < thr) & (sat < max(20, bg_sat + 12))
    cand = cand.astype(np.uint8)
    n, lab = cv2.connectedComponents(cand, connectivity=4)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border)) & (cand > 0)
    return bg


def red_skin_fraction(rgba):
    a = rgba[..., 3] > 128
    if a.sum() == 0:
        return 0.0
    b, g, r = [rgba[..., i].astype(np.int16) for i in range(3)]
    red = (r > 140) & (g < 120) & (b < 100) & (r - g > 60) & a
    return float(red.sum()) / float(a.sum())


def thumb(rgba):
    """64x64 grey image with the transparent area set to white, for shape comparison"""
    g = cv2.cvtColor(rgba[..., :3], cv2.COLOR_BGR2GRAY).astype(np.float32)
    g[rgba[..., 3] < 128] = 255
    return cv2.resize(g, (64, 64), interpolation=cv2.INTER_AREA)


def shape_diff(a, b):
    return float(np.abs(a - b).mean()), float(np.abs(a - b[:, ::-1]).mean())


def cut(args):
    img = cv2.imread(args.src, cv2.IMREAD_COLOR)
    if img is None:
        return {"pieces": [], "checks": [check("error", "unreadable", "Could not read this image file.")], "info": {}}
    h, w = img.shape[:2]
    checks = []
    f = img.astype(np.float32)
    bgc, cstd, cmeds = corner_stats(f)
    spread = max(np.abs(c - bgc).max() for c in cmeds)
    info = {"width": w, "height": h, "background": [int(x) for x in bgc[::-1]], "method": None}

    if cstd.max() > 18 or spread > 40:
        checks.append(check("error", "background_not_flat",
                            "The background isn't one flat colour, so pieces can't be cut out cleanly. Regenerate with a plain light-grey background."))

    method = args.method
    if method == "auto":
        method = "distance"
    info["method"] = method
    bg = background_mask(img, method, args.threshold)
    fg = (~bg).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n2, lab2, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    alpha_full = cv2.GaussianBlur((fg * 255).astype(np.uint8), (3, 3), 0)
    rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    min_area = args.min_area or max(1500, int(w * h * 0.0012))

    comps = [i for i in range(1, n2) if stats[i][4] >= min_area]
    # biggest first for objects, reading order (top-left first) for split sheets
    comps.sort(key=lambda i: (stats[i][1] // max(1, h // 4), stats[i][0]))
    os.makedirs(args.out, exist_ok=True)
    pieces = []
    for k, i in enumerate(comps):
        x, y, bw, bh, area = [int(v) for v in stats[i]]
        m = cv2.dilate((lab2 == i).astype(np.uint8), np.ones((3, 3), np.uint8))
        piece = rgba.copy()
        piece[..., 3] = np.minimum(alpha_full, m * 255)
        x0, y0, x1, y1 = max(x - 2, 0), max(y - 2, 0), min(x + bw + 2, w), min(y + bh + 2, h)
        crop = piece[y0:y1, x0:x1]
        name = args.name if len(comps) == 1 and args.kind in ("character", "object") else f"{args.name}_{k:02d}"
        fn = f"{name}.png"
        cv2.imwrite(os.path.join(args.out, fn), crop)
        touches = x <= 1 or y <= 1 or x + bw >= w - 1 or y + bh >= h - 1
        hist = cv2.calcHist([crop], [0, 1, 2], (crop[..., 3] > 128).astype(np.uint8), [8, 8, 8], [0, 256] * 3)
        cv2.normalize(hist, hist)
        pieces.append({"file": fn, "name": name, "x": x, "y": y, "w": int(x1 - x0), "h": int(y1 - y0), "area": area,
                       "touchesBorder": bool(touches), "redSkin": round(red_skin_fraction(crop), 4), "_hist": hist,
                       "_img": thumb(crop), "flags": []})

    # ---- checks
    if not pieces:
        checks.append(check("error", "no_pieces", "No pieces found. The subject may be the same colour as the background; try the grey method or a lower threshold."))
    for p in pieces:
        if p["touchesBorder"]:
            p["flags"].append("touches_border")
    if any(p["touchesBorder"] for p in pieces):
        checks.append(check("warn", "touches_border",
                            "A piece touches the image border and may be clipped. If a grey suit or sleeve got eaten, re-cut with the colour-distance method and a lower threshold (20-25).",
                            pieces=[p["name"] for p in pieces if p["touchesBorder"]]))
    # duplicates (Gemini often draws three shoes)
    for i, a in enumerate(pieces):
        for b in pieces[:i]:
            if "duplicate" in b["flags"]:
                continue
            if abs(a["w"] - b["w"]) / max(a["w"], b["w"]) < 0.12 and abs(a["h"] - b["h"]) / max(a["h"], b["h"]) < 0.12:
                # a left/right pair is a mirror image (both needed); a true duplicate matches without flipping
                direct, flipped = shape_diff(a["_img"], b["_img"])
                if cv2.compareHist(a["_hist"], b["_hist"], cv2.HISTCMP_CORREL) > 0.95 and direct < 18 and direct < flipped * 0.8:
                    a["flags"].append("duplicate")
                    a["dupOf"] = b["name"]
                    break
    dups = [p["name"] for p in pieces if "duplicate" in p["flags"]]
    if dups:
        checks.append(check("info", "duplicates", f"Looks like duplicate pieces ({', '.join(dups)}). Extras are ignored; just don't use them.", pieces=dups))
    if args.kind in ("split", "character"):
        reds = [p["name"] for p in pieces if p["redSkin"] > 0.07]
        for p in pieces:
            if p["redSkin"] > 0.07:
                p["flags"].append("red_skin")
        if reds:
            checks.append(check("warn" if args.kind == "split" else "info", "red_skin",
                                "Possible brick-red skin on a hand or leg (Gemini uses red as shadow). Use 'Fix red skin' on those pieces, unless the red is clothing.",
                                pieces=reds))
    if args.kind == "split":
        real = [p for p in pieces if "duplicate" not in p["flags"]]
        if args.expect and len(real) < args.expect:
            checks.append(check("error", "arms_attached",
                                f"Expected {args.expect} pieces but found {len(real)}. The arms are probably still attached to the torso, or pieces touch. Use the fix prompt below in the same Gemini chat."))
        elif args.expect and len(real) > args.expect + 1:
            checks.append(check("info", "extra_pieces", f"Found {len(real)} pieces, expected {args.expect}. Label the ones you need; ignore the rest."))
        if real:
            big = max(real, key=lambda p: p["area"])
            if big["w"] > big["h"] * 1.05:
                checks.append(check("warn", "wide_torso", f"The largest piece ({big['name']}) is wider than tall, a sign the arms are attached to the torso."))
    if args.kind in ("character", "object") and len(pieces) > 1:
        checks.append(check("info", "several_pieces", f"Found {len(pieces)} pieces; expected one. Small bits may be loose props. Label the main one."))

    for p in pieces:
        p.pop("_hist", None)
        p.pop("_img", None)
    return {"pieces": pieces, "checks": checks, "info": info}


def background(args):
    img = cv2.imread(args.src, cv2.IMREAD_COLOR)
    if img is None:
        return {"pieces": [], "checks": [check("error", "unreadable", "Could not read this image file.")], "info": {}}
    h, w = img.shape[:2]
    checks = []
    small = cv2.resize(img, (1000, int(1000 * h / w)))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    sharp = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    # rows that are almost one flat colour: Gemini's empty grey bands
    row_std = small.astype(np.float32).std(axis=(1, 2)) if small.ndim == 3 else gray.std(1)
    flat = row_std < 5
    longest, run = 0, 0
    for v in flat:
        run = run + 1 if v else 0
        longest = max(longest, run)
    band = longest / len(flat)
    if sharp < 60:
        checks.append(check("error", "blurry", f"The background looks blurry (sharpness {sharp:.0f}). Regenerate it wide 16:9, 'sharp and crisp, every shape in focus, no blur'."))
    elif sharp < 140:
        checks.append(check("warn", "soft", f"The background is a little soft (sharpness {sharp:.0f})."))
    if band > 0.12:
        checks.append(check("error", "empty_band", f"About {band * 100:.0f}% of the height is an empty flat band. This is the known 9:16 failure; regenerate it wide 16:9."))
    if h > w:
        checks.append(check("warn", "portrait", "This background is portrait. Gemini's 9:16 backgrounds often fail; wide 16:9 works better (the app crops and pans it)."))
    os.makedirs(args.out, exist_ok=True)
    fn = f"{args.name}.jpg"
    cv2.imwrite(os.path.join(args.out, fn), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return {"pieces": [{"file": fn, "name": args.name, "w": w, "h": h, "flags": [], "background": True}],
            "checks": checks, "info": {"width": w, "height": h, "sharpness": round(sharp, 1), "flatBand": round(band, 3)}}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--kind", default="objects")
    ap.add_argument("--expect", type=int, default=0)
    ap.add_argument("--method", default="auto")
    ap.add_argument("--threshold", type=float, default=30)
    ap.add_argument("--min-area", type=int, default=0)
    a = ap.parse_args()
    res = background(a) if a.kind == "background" else cut(a)
    json.dump(res, sys.stdout)
