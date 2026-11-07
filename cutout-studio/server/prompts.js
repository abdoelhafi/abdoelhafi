// Every prompt the app sends to an LLM, plus the deterministic Gemini image prompts.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SEED_IDEAS = JSON.parse(read('server/seed-ideas.json'));
const ROLODEX_SCRIPT = read('examples/rolodex/script.json');
const ROLODEX_TIMELINE = read('examples/rolodex/timeline.json');
const TIMELINE_DOC = read('docs/TIMELINE.md');

const brandBlock = (s) => `BRAND: ${s.brand.name}. ${s.brand.description}
How the brand may appear: ${s.brand.ending}
Rules:
${s.brand.rules.map((r) => `- ${r}`).join('\n')}`;

// ---------------------------------------------------------------- ideas
export function ideasPrompt({ theme, count = 15, settings, exclude = [] }) {
  const examples = SEED_IDEAS.slice(0, 3);
  const system = `You find fact-based "curiosity" story ideas for short vertical paper cut-out animation videos (about 55 seconds, TikTok/Reels/Shorts).

${brandBlock(settings)}

Idea family: ${settings.ideaFamily}

What works:
- The first 3 seconds decide everything: motion + conflict + a mystery. Each idea needs a hook line that makes people stay.
- The story teaches something curious and true. The arc: hook question -> reveal -> origin -> how it became big -> the human meaning -> a loss or twist -> today's relatable problem -> a quiet close that bridges naturally to ${settings.brand.name} (never a sales pitch).
- It must be easy to show as paper cut-outs: concrete objects, invented characters, places.

FACT-CHECKING (non-negotiable):
- Use web search to verify every number, date and name you use. Give 2 published sources with real URLs you actually found.
- Never invent numbers. Write "about" or "estimated" when a figure is an estimate, and say so in "check".
- If sources disagree or you could not verify the core fact, set "verified": false and explain in "check". Unverified ideas are hidden from production.
- Avoid real people's likeness as characters; a real event is fine, but show invented characters.`;

  const prompt = `Theme from the user: "${theme}"

Find ${count} different ideas. Avoid these titles, already used: ${[...SEED_IDEAS.map((i) => i.title), ...exclude].map((t) => `"${t}"`).join(', ')}.

Return ONLY a JSON object in a \`\`\`json fenced block, shaped exactly like this:
{"ideas": [ {
  "id": "short-kebab-id",
  "theme": "short theme label",
  "title": "curiosity headline",
  "hook": "the FIRST 3 SECONDS narration line",
  "beats": ["beat 1", "beat 2", "beat 3", "beat 4"],
  "visuals": "cut-out visual ideas",
  "ukeepMoment": "how it ends naturally, bridging to ${settings.brand.name}",
  "sources": [{"label": "Publisher: article title", "url": "https://..."}, {"label": "...", "url": "https://..."}],
  "check": "where sources disagree or a number is an estimate (empty string if none)",
  "verified": true
} ]}

Three examples of the quality and format wanted:
${JSON.stringify(examples, null, 1)}`;
  return { system, prompt };
}

// ---------------------------------------------------------------- script
export function scriptPrompt({ idea, settings, notes = '' }) {
  const system = `You write narration scripts and shot plans for short vertical paper cut-out animation videos (9:16, 30 fps, about 50-55 seconds).

${brandBlock(settings)}

NARRATION (it is sent to ElevenLabs Eleven v4 in ONE request):
- Exactly 8 lines, 120-150 spoken words in total, under 1,050 characters including tags (the user is on a free tier: about 10,000 characters a month).
- Each line has a short voice direction "tag" in English (it becomes a square-bracket audio tag, e.g. "Intrigued, low, documentary narrator"). Tags are directions, not spoken.
- Use ellipses "..." for pauses. No SSML, no stage directions inside the text, no emojis.
- Line 1 is the hook and is spoken from frame 1. Arc: hook question -> reveal -> origin -> how it became big -> the human meaning -> the loss/twist -> today's relatable problem -> quiet close that bridges to ${settings.brand.name}.
- Only facts from the idea and its sources. Say "about"/"estimated" for estimates. Never invent numbers.

ON-SCREEN TEXT (the user insists on minimal text):
- "hookText": the hook line on screen in frame 1, at most 9 words (use \\n for a line break).
- "punchWords": at most 2 single words or numbers shown later (e.g. "ROLODEX", "1956"), each with the exact narration words they land on ("cue").

SCENES: 6-8 scenes. Each scene starts on a spoken key phrase: "cue" must be copied EXACTLY from the narration text (2-4 consecutive words). The first scene's cue is the first words of line 1.
For each scene: what we see ("picture"), the assets it needs (asset ids), a background ("background": one of the drawn presets plain, radial, spotlight, sunburst, window-city, office, stage, expo, skyline, landscape, or an asset id of kind "background"), and the motion ideas. The last scene is the brand close.

ASSETS (images the user will generate in Gemini and upload; they are cut into transparent paper pieces):
- kind "character": one invented person, full body. Give their look precisely (age, clothes, colours, hair, pose, expression) so Gemini can keep them consistent.
- kind "object": one object. kind "objects": several small separate objects in one image; list their "pieceNames" (one id per object, in left-to-right order).
- kind "background": only if a drawn preset can't work; Gemini backgrounds often fail, prefer presets.
- Set "split": true on a character only if a limb must move independently (waving, walking); otherwise full-body characters animate fine.
- Ids: short snake_case. Reuse assets across scenes. 8-14 assets is typical. Never ask for text, logos or real people in images.

Return ONLY JSON shaped like this example (the Rolodex video, which performed well):
${ROLODEX_SCRIPT}`;

  const prompt = `Write the script and shot plan for this idea:
${JSON.stringify(idea, null, 1)}
${notes ? `\nNotes from the user: ${notes}` : ''}`;
  return { system, prompt };
}

// ---------------------------------------------------------------- timeline
export function timelinePrompt({ script, words, library, settings, duration, notes = '' }) {
  const system = `You are the animator. You turn a narration script, its word timestamps and a library of cut-out paper pieces into a timeline JSON for a paper cut-out animation engine. Here is the complete format:

${TIMELINE_DOC}

A finished timeline for the Rolodex video (it uses pieces from its own library; your library is different):
${ROLODEX_TIMELINE}

Rules:
- Use ONLY piece names from the library given. Never invent a piece. If an asset is missing, use a drawn background, a shape, text or an effect instead.
- Times: use "@words" cues copied exactly from the word list, so cuts land on the spoken words. Scene 1 starts at 0.
- Total duration = the narration duration given (add ~1.5 s at the end for the logo to settle).
- On-screen text: only the hook text in scene 1 and the punch words; nothing else.
- Every scene has motion all the time (a loop on the hero, a slow camera push, something entering on key words).
- Size pieces from their aspect ratio: a hero 600-900 px wide; props 200-400 px. Keep inside x 80..1000, y 250..1700 (pieces entering from off-screen are fine).
- The brand (${settings.brand.name}) appears only in the last scene${settings.brand.showLogo ? ' (the "logo" effect near y 1760)' : ' (no logo)'}.
Return ONLY the timeline JSON.`;

  const lib = Object.entries(library).map(([name, p]) => `${name} (${p.kind || 'piece'}, ${p.w}x${p.h}${p.label ? `, ${p.label}` : ''})`).join('\n');
  const prompt = `SCRIPT (with scene plan):
${JSON.stringify({ hookText: script.hookText, punchWords: script.punchWords, lines: script.lines, scenes: script.scenes }, null, 1)}

NARRATION DURATION: ${duration.toFixed(2)} s

WORD TIMESTAMPS (word@start seconds):
${words.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(' ')}

PIECE LIBRARY (name, kind, natural size):
${lib || '(empty: use drawn backgrounds, shapes, text and effects)'}
${notes ? `\nNotes from the user: ${notes}` : ''}`;
  return { system, prompt };
}

// ---------------------------------------------------------------- piece labelling (vision)
export function labelPrompt({ asset, names, pieces }) {
  const system = 'You identify cut-out paper pieces on a numbered contact sheet. Answer with JSON only.';
  const prompt = `The contact sheet shows ${pieces.length} pieces cut from one image of: "${asset.description}".
${names.length ? `Give each piece one of these names: ${names.join(', ')}. Use "skip" for duplicates, loose bits or pieces you don't need.` : `Give each piece a short snake_case name starting with "${asset.id}_" (e.g. ${asset.id}_head, ${asset.id}_torso, ${asset.id}_arm_l).`}
Left/right means the character's own left/right.
Return: {"labels": [{"n": 1, "name": "..."}, ...]}`;
  return { system, prompt };
}

// ---------------------------------------------------------------- Gemini image prompts (deterministic)
export const SPLIT_PIECES = ['head with neck', 'torso', 'left upper arm', 'left forearm with hand', 'right upper arm', 'right forearm with hand', 'left leg with shoe', 'right leg with shoe'];
export const SPLIT_NAMES = ['head', 'torso', 'arm_upper_l', 'forearm_l', 'arm_upper_r', 'forearm_r', 'leg_l', 'leg_r'];

export function imagePrompts(asset, settings) {
  const S = settings.style;
  const desc = asset.description.replace(/\.$/, '');
  if (asset.kind === 'background') {
    return {
      prompt: `${S.block.replace(/,?\s*plain solid light-grey background/i, '')}. A WIDE 16:9 full-frame background scene, sharp and crisp, every shape in focus, no blur, no motion blur, fills the whole frame edge to edge, no characters, empty space in the middle where a character will stand: ${desc}.`,
    };
  }
  if (asset.kind === 'character') {
    const out = { prompt: `${S.block}, ${S.characterPose} ${capital(desc)}.` };
    if (asset.split) out.splitPrompt = splitPrompt();
    return out;
  }
  if (asset.kind === 'objects') {
    return { prompt: `${S.block}. ${capital(desc)}. Separate objects, not touching, with clear space between them.` };
  }
  return { prompt: `${S.block}. ${capital(desc)}. One object only, centred, with space around it.` };
}

export function splitPrompt() {
  return `Keep this exact character: same face, hair, clothes and colours as in this image. Split them into separate cut-out pieces laid out on a plain light-grey background, not overlapping, with space between them. The torso must have NO arms attached, just the jacket/shirt with round shoulder stumps. Then exactly these pieces, one of each: ${SPLIT_PIECES.join('; ')}. Both hands the same skin colour as the face. No extra shoes or hands. Same paper cut-out style with white scissor-cut edges. No text.`;
}

/** The prompt to paste back into Gemini when a check fails. */
export function fixPrompt(code, asset, settings) {
  switch (code) {
    case 'arms_attached': case 'wide_torso':
      return `That didn't work: the arms are still attached to the torso. ${splitPrompt()}`;
    case 'blurry': case 'empty_band': case 'soft': case 'portrait':
      return `That background came out ${{ empty_band: 'with empty grey bands', portrait: 'tall (9:16), which tends to fail', soft: 'a little soft' }[code] || 'blurry'}. ${imagePrompts({ ...asset, kind: 'background' }, settings).prompt}`;
    case 'background_not_flat': case 'no_pieces':
      return 'Same image, but on a plain solid light-grey background with nothing else: no floor, no shadows on the background, no scenery. Keep the white scissor-cut edges.';
    case 'touches_border':
      return 'Same image, but smaller in the frame with plenty of empty light-grey space around every piece. Nothing may touch the edges of the image.';
    case 'red_skin':
      return 'Same image, but make all skin (hands, legs, face) the same natural skin colour as the face. Do not use red for skin or shadows on skin.';
    default:
      return '';
  }
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function ttsText(script) {
  return script.lines.map((l) => `[${l.tag}] ${l.text.trim()}`).join('\n\n');
}
