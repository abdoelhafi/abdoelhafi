"""Synthesize the sound-effect track from timed events (no samples, no licences).

Usage: python sfx.py events.json DURATION out.wav
events.json: [{"type": "whoosh", "t": 0.0, "gain": 0.6, "dur": 0.4, "freq": null}, ...]
types: whoosh clack pop thump rustle tick chime beep wind boom
"""
import json, sys, wave
import numpy as np

SR = 48000
rng = np.random.default_rng(3)


def env(n, a=.005, r=.1):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / r)


def lp(x, k):
    """one-pole low-pass with a per-sample (or constant) coefficient"""
    k = np.broadcast_to(np.asarray(k, dtype=np.float64), x.shape)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += k[i] * (x[i] - acc)
        y[i] = acc
    return y


def whoosh(d=.45, g=.5, **_):
    n = int(d * SR); x = rng.standard_normal(n); t = np.linspace(0, 1, n)
    y = lp(x, 0.02 + 0.25 * np.sin(np.pi * t) ** 2)
    return y * np.sin(np.pi * t) ** 1.5 * g


def clack(**_):
    n = int(.12 * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1800 * t) * .5 + rng.standard_normal(n) * .6) * np.exp(-t / .012) * .9


def pop(f=520, **_):
    n = int(.14 * SR); t = np.arange(n) / SR; fr = f * (1 + 1.2 * np.exp(-t / .02))
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * env(n, .002, .04) * .6


def thump(**_):
    n = int(.35 * SR); t = np.arange(n) / SR; fr = 110 * (1 + 2 * np.exp(-t / .03))
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * env(n, .002, .09) * .9 + rng.standard_normal(n) * np.exp(-t / .01) * .25


def rustle(d=.35, **_):
    n = int(d * SR); x = rng.standard_normal(n); y = x - lp(x, .3)
    am = (rng.random(n // 400 + 1) > .5).repeat(400)[:n] * .7 + .3
    return y * am * np.sin(np.pi * np.linspace(0, 1, n)) * .35


def tick(**_):
    n = int(.03 * SR); t = np.arange(n) / SR
    return rng.standard_normal(n) * np.exp(-t / .004) * .35


def chime(**_):
    n = int(1.2 * SR); t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * f * t) * a for f, a in [(1046, .5), (1568, .3), (2093, .2)])
    return s * env(n, .003, .35) * .35


def beep(**_):
    n = int(.7 * SR); t = np.arange(n) / SR; fr = 900 + 600 * t / .7
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.sin(np.pi * t / .7) * .18


def wind(d=2.2, **_):
    n = int(d * SR); x = rng.standard_normal(n); y = lp(x, .03); t = np.linspace(0, 1, n)
    return y * np.sin(np.pi * t) * (0.7 + 0.3 * np.sin(2 * np.pi * 3 * t)) * 1.6


def boom(**_):
    n = int(.8 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * 70 * t) * env(n, .01, .25) * .6


GEN = dict(whoosh=whoosh, clack=clack, pop=pop, thump=thump, rustle=rustle, tick=tick, chime=chime, beep=beep, wind=wind, boom=boom)


def main():
    events = json.load(open(sys.argv[1]))
    dur = float(sys.argv[2])
    out = np.zeros(int(SR * dur) + SR * 3)
    cache = {}
    for e in events:
        typ = e.get("type")
        if typ not in GEN:
            continue
        kw = {}
        if typ in ("whoosh", "rustle", "wind") and e.get("dur"):
            kw["d"] = float(e["dur"])
        if typ == "pop" and e.get("freq"):
            kw["f"] = float(e["freq"])
        key = (typ, tuple(sorted(kw.items())), len(cache) % 3 if typ in ("whoosh", "rustle", "wind") else 0)
        if key not in cache:
            cache[key] = GEN[typ](**kw)
        sig = cache[key] * float(e.get("gain", 1))
        i = int(max(0.0, float(e["t"])) * SR)
        if i >= len(out):
            continue
        out[i:i + len(sig)] += sig[:len(out) - i]
    out = out[:int(SR * dur)]
    peak = np.max(np.abs(out)) if out.size else 0
    if peak > 0:
        out = out / peak * 0.5
    w = wave.open(sys.argv[3], "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype(np.int16).tobytes()); w.close()
    print(json.dumps({"ok": True, "events": len(events)}))


if __name__ == "__main__":
    main()
