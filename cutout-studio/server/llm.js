// One interface over Claude, Gemini and an offline mock: generateJSON({ task, system, prompt, webSearch, images }).
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { config, activeProvider, geminiError } from './config.js';
import * as mock from './mock.js';

let anthropic, gemini;
const claudeClient = () => (anthropic ??= new Anthropic({ apiKey: config.anthropicKey }));
const geminiClient = () => (gemini ??= new GoogleGenAI({ apiKey: config.geminiKey }));

export function providerInfo() {
  const p = activeProvider();
  return {
    provider: p,
    model: p === 'claude' ? config.claudeModel : p === 'gemini' ? config.geminiModel : 'offline fixtures',
    claudeReady: !!config.anthropicKey,
    geminiReady: !!config.geminiKey,
    geminiImageReady: !!config.geminiKey,
    elevenReady: !!config.elevenKey,
  };
}

/**
 * @param {object} o
 * @param {string} o.task       name of the step (used by the mock provider)
 * @param {string} o.system     system prompt
 * @param {string} o.prompt     user prompt
 * @param {boolean} [o.webSearch] let the model search the web (fact-checking ideas)
 * @param {{path:string, mime:string}[]} [o.images] images to show the model (piece labelling)
 * @param {string} [o.provider] override the active provider
 */
export async function generateJSON(o) {
  const provider = o.provider || activeProvider();
  let text;
  if (provider === 'claude') text = await claude(o);
  else if (provider === 'gemini') text = await geminiText(o);
  else if (provider === 'mock') return mock.respond(o.task, o);
  else throw new Error(`Unknown LLM provider "${provider}"`);
  return extractJSON(text);
}

async function claude({ system, prompt, webSearch, images = [] }) {
  const content = [
    ...images.map((im) => ({
      type: 'image',
      source: { type: 'base64', media_type: im.mime, data: fs.readFileSync(im.path).toString('base64') },
    })),
    { type: 'text', text: prompt },
  ];
  const messages = [{ role: 'user', content }];
  const tools = webSearch ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 12 }] : undefined;
  let text = '';
  // Server tools can return stop_reason "pause_turn": send the turn back to let it continue.
  for (let round = 0; round < 4; round++) {
    const res = await claudeClient().beta.messages.stream({
      model: config.claudeModel,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // on a safety decline, the API retries on a recommended fallback model
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system,
      messages,
      ...(tools ? { tools } : {}),
    }).finalMessage();
    if (res.stop_reason === 'refusal') {
      throw new Error(`Claude declined this request${res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : ''}`);
    }
    text += res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (res.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens; try a shorter request.');
    if (res.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: res.content });
  }
  return text;
}

async function geminiText({ system, prompt, webSearch, images = [] }) {
  const parts = [
    ...images.map((im) => ({ inlineData: { mimeType: im.mime, data: fs.readFileSync(im.path).toString('base64') } })),
    { text: prompt },
  ];
  const res = await geminiClient().models.generateContent({
    model: config.geminiModel,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: system,
      // Google Search grounding can't be combined with JSON mode, so search runs return fenced JSON we parse.
      ...(webSearch ? { tools: [{ googleSearch: {} }] } : { responseMimeType: 'application/json' }),
    },
  }).catch((e) => { throw geminiError(e); });
  const t = res.text;
  if (!t) throw new Error(`Gemini returned no text (finish reason: ${res.candidates?.[0]?.finishReason || 'unknown'})`);
  return t;
}

/** Pull the JSON value out of a model reply (fenced block, or the outermost {...} / [...]). */
export function extractJSON(text) {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = [...fences.reverse(), text];
  for (const c of candidates) {
    const s = c.trim();
    try { return JSON.parse(s); } catch { /* try a slice */ }
    for (const [open, close] of [['{', '}'], ['[', ']']]) {
      const a = s.indexOf(open), b = s.lastIndexOf(close);
      if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* next */ } }
    }
  }
  const e = new Error('The model did not return valid JSON. Try again.');
  e.raw = text.slice(0, 2000);
  throw e;
}
