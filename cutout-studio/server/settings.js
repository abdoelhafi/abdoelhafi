// Brand + style settings, editable in the app (data/settings.json). Defaults are uKeep's.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'settings.json');

export const UKEEP_LOGO_SVG = `<svg viewBox="44 15 3032 945" xmlns="http://www.w3.org/2000/svg"><path fill="#F2533F" d="M251 772Q151 772 98 710Q44 647 44 545V332H194V533Q194 580 222 608Q250 637 294 637Q338 637 366 608Q394 580 394 533V332H544V760H404V693Q383 733 343 752Q303 772 251 772Z"/><path fill="#0A0A0A" d="M44 214H194V332H44ZM394 214H544V332H394Z"/><path fill="#0A0A0A" d="M647 760V15H802V321L1057 15H1251L999 319L1257 760H1076L894 445L802 556V760ZM1568 772Q1481 772 1417 734Q1353 695 1318 630Q1283 565 1283 486Q1283 404 1320 340Q1356 276 1418 239Q1480 202 1558 202Q1645 202 1705 238Q1765 274 1796 334Q1828 395 1828 471Q1828 487 1826 502Q1825 518 1821 529H1439Q1445 580 1480 611Q1515 642 1570 642Q1610 642 1638 626Q1667 610 1683 582L1803 639Q1778 699 1715 736Q1652 772 1568 772ZM1558 322Q1514 322 1484 347Q1453 372 1442 419H1669Q1664 376 1634 349Q1604 322 1558 322ZM2161 772Q2074 772 2010 734Q1946 695 1911 630Q1876 565 1876 486Q1876 404 1912 340Q1949 276 2011 239Q2073 202 2151 202Q2238 202 2298 238Q2358 274 2390 334Q2421 395 2421 471Q2421 487 2420 502Q2418 518 2414 529H2032Q2038 580 2073 611Q2108 642 2163 642Q2203 642 2232 626Q2260 610 2276 582L2396 639Q2371 699 2308 736Q2245 772 2161 772ZM2151 322Q2107 322 2076 347Q2046 372 2035 419H2262Q2257 376 2227 349Q2197 322 2151 322ZM2491 960V214H2631V271Q2689 202 2798 202Q2876 202 2939 240Q3002 278 3039 342Q3076 407 3076 487Q3076 566 3040 631Q3003 696 2940 734Q2877 772 2797 772Q2751 772 2710 758Q2670 745 2641 718V960ZM2779 637Q2841 637 2881 595Q2921 553 2921 487Q2921 422 2881 380Q2841 337 2779 337Q2718 337 2680 379Q2641 421 2641 487Q2641 554 2680 596Q2718 637 2779 637Z"/></svg>`;

export const DEFAULT_SETTINGS = {
  brand: {
    name: 'uKeep',
    description: 'A business card scanner and contact manager for the people you meet in person. Scan a card and it becomes a contact in seconds, with a note on where you met, so you can find anyone later and follow up by call, email or WhatsApp in one tap.',
    ending: 'The brand appears only in the last ~3 seconds: a small logo and a natural "remember the people you meet" close, or only in the caption. The video must never look like an ad.',
    rules: [
      'Never fabricate stats, ratings, customers or testimonials. Every fact needs a published source; say "about" or "estimated" for estimates.',
      'Fictional demo content (e.g. a contact named "Sara K.") must be clearly generic, never presented as a real customer.',
      "Invented characters only: no real people's likeness, no celebrities.",
    ],
    showLogo: true,
    logoSvg: UKEEP_LOGO_SVG,
  },
  ideaFamily: 'Curiosity stories in the family of "how millionaires legally avoid tax" and "empty private jets moving art". Topics: money & loopholes, deals made on a handshake, the science of who you know, hidden economics of events and trade shows.',
  style: {
    block: 'Paper cut-out collage illustration, flat colours with visible paper grain, slightly rough scissor-cut white edges around every shape, soft drop shadow as if paper is lifted 2 mm off the background, limited palette of navy, mustard yellow, brick red, off-white and black, mid-century editorial magazine style, no text, no logos, plain solid light-grey background',
    characterPose: 'character shown full body facing three-quarter left.',
    palette: { navy: '#24324F', mustard: '#E1A73A', brick: '#C2502F', cream: '#F1E6CC', ink: '#1B2238' },
  },
  voice: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
  renderMode: 'instance', // 'instance' (this server) or 'github' (GitHub Actions)
};

export function getSettings() {
  if (!fs.existsSync(FILE)) return structuredClone(DEFAULT_SETTINGS);
  const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return {
    ...DEFAULT_SETTINGS, ...s,
    brand: { ...DEFAULT_SETTINGS.brand, ...s.brand },
    style: { ...DEFAULT_SETTINGS.style, ...s.style },
    voice: { ...DEFAULT_SETTINGS.voice, ...s.voice },
  };
}

export function saveSettings(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
  return getSettings();
}
