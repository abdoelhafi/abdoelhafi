// Offline provider: lets the whole app run with no API keys (returns the Rolodex fixtures).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const json = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

export function respond(task, o = {}) {
  switch (task) {
    case 'ideas': return { ideas: json('server/seed-ideas.json') };
    case 'script': return json('examples/rolodex/script.json');
    case 'timeline': return json('examples/rolodex/timeline.json');
    case 'label': {
      const names = o.names || [];
      return { labels: (o.pieces || []).map((p, i) => ({ n: i + 1, name: names[i] || p.name })) };
    }
    default: throw new Error(`mock provider has no answer for "${task}"`);
  }
}
