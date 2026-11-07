# Timeline format

A video is one JSON object. The engine (`engine/engine.js`) turns it into a GSAP animation on a 1080×1920 stage at 30 fps. The same file plays live in the browser preview and is rendered frame by frame to MP4.

```json
{
  "duration": 56.6,
  "palette": { "navy": "#24324F" },
  "scenes": [ { "id": "s1-hook", "start": 0, "background": {}, "camera": [], "elements": [], "sfx": [] } ]
}
```

## Times

Every time field (`start`, `end`, `at`, `from`, `to` in loops, `times`, `flyAt`, `noteAt`) accepts:

| Form | Meaning |
|---|---|
| `12.4` | absolute seconds |
| `"@The Rolodex"` | the moment those words start in the narration (from ElevenLabs timestamps) |
| `"@The Rolodex+0.2"`, `"@value-0.1"` | offset in seconds |
| `"@card#2"` | the second time "card" is spoken |
| `"@lost$end"` | when those words finish |
| `"+0.5"` | seconds after the scene starts |

Cut scenes on the spoken key words. Words must be copied exactly from the narration (punctuation is ignored). A scene's `end` defaults to the next scene's `start`; the last scene ends at `duration`.

## Coordinates

`x`, `y` = centre of the element in stage pixels (0..1080, 0..1920). `w` = width in pixels; the height follows the image's aspect ratio. Keep important things inside x 80..1000 and y 250..1700 (TikTok/Reels UI covers the edges). Elements are layered in list order (later = on top), or with `z`.

## Scene

| Field | |
|---|---|
| `id` | short name |
| `start`, `end` | times |
| `background` | `{ "preset": "<name>", "colors": { ... } }`, or `{ "image": "<piece name>", "pan": "zoom" \| "left" \| "right" \| "none" }`, or `{ "color": "#hex" }` |
| `camera` | list of moves: `{ "at", "from": {scale,x,y,rotation}, "to": {scale,x,y,rotation}, "origin": [x, y], "duration", "ease" }` or a shake `{ "at", "shake": 12 }`. A zoom-in-then-pull-back reveal: `from {scale: 3.2}` to `{scale: 1}` with `origin` on the object being revealed. A slow push-in: `to {scale: 1.08}`, `ease: "none"`, for the whole scene. |
| `elements` | list of elements (below) |
| `sfx` | extra sounds: `{ "type": "chime", "at": "@remember", "gain": 1 }` (most sounds are added automatically) |
| `transition` | `"cut"` (default, with a whoosh) or `"none"` (no whoosh) |

### Background presets (drawn in code as paper collage)

`plain`, `radial` (cream with soft concentric circles; good for diagrams, networks and the end card), `spotlight` (dark navy with a glow and a floor; good for a hook), `sunburst`, `window-city` (an office window with a sunset skyline), `office` (1950s office wall, windows with blinds, wainscot, wood floor), `stage` (curtains, light beams; showbiz and TV), `expo` (trade-show booths and lights), `skyline` (night city), `landscape` (sun and hills).
Override colours with `colors`, e.g. `{ "base": "#1E2A47", "floor": "brick" }`. Palette names: navy, dnavy, mustard, brick, cream, paper, ink, teal, wood, grey, black, white, sand, plum, sky.

## Elements

Common fields: `id`, `x`, `y`, `w`, `h` (shapes and effects), `rotation`, `opacity`, `z`, `flip` (mirror an image), `origin` (`"bottom"` for people and things that sway from the floor), `fixed` (true = not affected by the camera), `enter`, `exit`, `loop` or `loops`, `actions`, `sfx: false` (mute its automatic sounds).

Kinds:

- **Image piece**: `{ "piece": "exec", "x": 540, "y": 1010, "w": 880 }`. `piece` must be a name from the piece library.
- **Text**: `{ "text": "ROLODEX", "style": "strip" | "stamp" | "label" | "plain", "size": 110, "x": 540, "y": 300, "rotation": 2 }`. Use `\n` for a line break. Keep on-screen text minimal: the hook line, and at most 1–2 punch words later.
- **Shape**: `{ "shape": "rect" | "circle", "fill": "cream" or any CSS background (gradients allowed), "x", "y", "w", "h", "radius" }`.
- **Effect**: `{ "effect": "<name>", ... }`:

| Effect | Fields | Use |
|---|---|---|
| `rays` | `x, y, r, count, color, speed` | spinning sunburst behind a hero object |
| `sparkles` | `x, y, w, h, count, at` | ✦ twinkles (adds a chime) |
| `burst` | `piece, x, y, times: [..], count, size` | pieces (cards, coins, notes) fly out of a point and fall |
| `question-marks` | `x, y, r, count, at, char` | paper "?" tiles pop in an arc above someone confused |
| `scan-beam` | `x, y, w, h, at, duration` | a glowing scan line sweeps down an area |
| `strings` | `from: id, to: [ids], at, color` | lines drawn from one element to others (networks) |
| `notes` | `count, at, flyAt` | blank paper notes pop in, then blow away at `flyAt` |
| `ticker` | `x, y, w, h, values: "ABC..." or [..], at, step` | a card flipping through letters, years or prices |
| `list` | `x, y, w, h, rows, at` | UI rows growing in (a phone screen, a ledger) |
| `contact` | `x, y, w, h, title, subtitle, note, note2, noteAt` | a contact card UI on a phone screen |
| `logo` | `x, y, w, at` | the brand logo (end card only) |

### enter (how it appears)

`{ "type": "...", "at": time, "duration": s }`. Before `at` the element is invisible.
Types: `pop` (scale up with overshoot), `grow`, `fade`, `zoom-in`, `stamp` (slams down from big + camera shake), `drop` (falls in and bounces), `spin`, `slide-left` (comes in from the left), `slide-right`, `slide-up`, `slide-down`, `none`.
Without `enter`, the element is there when the scene starts.

### exit (how it leaves)

`{ "type": "...", "at": time, "duration": s }`. Types: `fade`, `shrink`, `fly-left`, `fly-right`, `fly-up`, `fly-down`, `fall`, `wind` (blown off to the right, tumbling).

### loop (continuous motion while visible)

`{ "type": "...", "amount": n, "period": s, "from": time, "to": time }`. Types: `bob` (up/down), `float`, `sway` (rotate around `origin`, good for people), `wobble`, `breathe` (subtle; good for big characters), `pulse`, `spin` (degrees per second), `tug` (side-to-side tug of war; give several elements the same tug and they move together), `drift`.

### actions (one-off moves)

List of `{ "type": "...", "at": time, ... }`: `pulse` (`scale`), `shake` (`amount`), `jump` (`amount`), `spin` (`amount` degrees), `move` (`to: {x, y, scale, rotation, opacity}`, absolute stage coordinates), `scale` (`to: 2.3`), `rotate` (`to: -5`), `flash`, `hide`, `show`. All take `duration` and `ease` (GSAP eases such as `power2.out`, `back.out(2)`, `sine.inOut`, `none`).

## Sound effects

Added automatically: a whoosh on every scene cut and slide/fly, a pop for pop/grow/pulse, a thump for stamp/drop, rustles for bursts, ticks for tickers, a chime for sparkles and the logo, a beep for the scan beam, wind for `wind` exits. Extra sounds go in a scene's `sfx`; types: whoosh, clack, pop, thump, rustle, tick, chime, beep, wind, boom. No music: the user adds a trending sound on TikTok/Instagram.

## What makes it work

- Frame 1 has motion, conflict and a mystery object. The narration starts on frame 1: no intro, no logo.
- Each scene has one clear idea and something moving at all times (a loop on the hero, a slow camera push).
- Cut on the key word, with the visual change landing on that word.
- Big readable pieces: a hero is typically 600–900 px wide; props 200–400 px.
- The brand appears only at the very end.
