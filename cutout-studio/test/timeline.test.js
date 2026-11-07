import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { wordsFromAlignment, findPhrase, resolveTimeline } from '../server/timeline.js';
import { extractJSON } from '../server/llm.js';

const al = JSON.parse(fs.readFileSync(new URL('../examples/rolodex/vo/alignment.json', import.meta.url)));
const words = wordsFromAlignment(al);

test('audio tags are not words', () => {
  assert.equal(words[0].text, 'In');
  assert.ok(!words.some((w) => w.text.includes('[') || w.norm === 'intrigued'));
});

test('phrases resolve to the spoken time', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.02, `${a} vs ${b}`);
  near(findPhrase(words, 'The Rolodex').start, 6.64);
  near(findPhrase(words, 'The Rolodex#2').start, 51.2);
  near(findPhrase(words, 'fat Rolodex').start, 23.84);
  assert.equal(findPhrase(words, 'not in the script'), null);
});

test('the Rolodex timeline resolves with no problems and the original cuts', () => {
  const tl = JSON.parse(fs.readFileSync(new URL('../examples/rolodex/timeline.json', import.meta.url)));
  const { timeline, problems } = resolveTimeline(tl, { words, duration: 56.6 });
  assert.deepEqual(problems, []);
  const starts = timeline.scenes.map((s) => s.start);
  for (const [got, want] of starts.map((s, i) => [s, [0, 5.3, 10.1, 18.62, 26.42, 45.45, 51.2][i]])) assert.ok(Math.abs(got - want) < 0.06, `${got} vs ${want}`);
  // ids inside effects are not mistaken for times
  assert.equal(timeline.scenes[4].elements[0].from, 'rolo');
  // loop "from" is a time
  assert.equal(typeof timeline.scenes[5].elements[0].loop.from, 'number');
});

test('JSON is extracted from model replies', () => {
  assert.deepEqual(extractJSON('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJSON('Here: {"ideas":[1,2]} done'), { ideas: [1, 2] });
  assert.throws(() => extractJSON('no json here'));
});
