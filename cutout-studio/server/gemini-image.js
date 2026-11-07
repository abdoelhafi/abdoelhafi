// Optional: generate the images with the Gemini API instead of pasting prompts into the Gemini app.
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { config, geminiError } from './config.js';

let client;
const ai = () => (client ??= new GoogleGenAI({ apiKey: config.geminiKey, apiVersion: 'v1beta' }));

/**
 * @param {string} prompt
 * @param {{path:string, mime:string}[]} refs  reference images (e.g. the full-body character for a split)
 * @param {string} [aspectRatio] e.g. "16:9" for backgrounds
 * @returns {Promise<{buffer: Buffer, mime: string, text: string}>}
 */
export async function generateImage(prompt, refs = [], aspectRatio) {
  if (!config.geminiKey) throw new Error('Set GEMINI_API_KEY to generate images in the app (or paste the prompt into Gemini and upload the result).');
  const parts = [
    ...refs.map((r) => ({ inlineData: { mimeType: r.mime, data: fs.readFileSync(r.path).toString('base64') } })),
    { text: prompt },
  ];
  const res = await ai().models.generateContent({
    model: config.geminiImageModel,
    contents: [{ role: 'user', parts }],
    config: { responseModalities: ['IMAGE', 'TEXT'], ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}) },
  }).catch((e) => { throw geminiError(e); });
  const out = res.candidates?.[0]?.content?.parts || [];
  const img = out.find((p) => p.inlineData?.data);
  const text = out.filter((p) => p.text).map((p) => p.text).join(' ');
  if (!img) throw new Error(`Gemini returned no image${text ? `: ${text.slice(0, 300)}` : ` (finish reason: ${res.candidates?.[0]?.finishReason || 'unknown'})`}`);
  return { buffer: Buffer.from(img.inlineData.data, 'base64'), mime: img.inlineData.mimeType || 'image/png', text };
}
