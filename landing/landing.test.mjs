// Every element landing.js reaches for has to exist in index.html. There is no
// build step and no framework to catch a typo, so a renamed id fails silently
// in the browser — the section just never renders. This is that check.
//
//   node landing/landing.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const js = readFileSync(new URL('landing.js', dir), 'utf8');
const html = readFileSync(new URL('index.html', dir), 'utf8');

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

// Skip the template-literal ones (`${id}-covers`) — those are built at runtime
// from a prefix, and both prefixes are covered by the literal ids below.
const wanted = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
assert.ok(wanted.length > 10, 'no getElementById calls found — did the file move?');

const missing = wanted.filter(id => !ids.has(id));
assert.deepStrictEqual(missing, [], `landing.js reads ids that index.html does not define: ${missing}`);

// renderVerdict() is shared by the crowd's card and the model's, and only the
// crowd's shows thumbnails. Guard the pair so a future edit can't half-remove it.
assert.ok(ids.has('latest-covers'), 'the crowd verdict lost its covers strip');
assert.ok(!ids.has('ai-covers'), 'the model verdict should not repeat the covers');

console.log(`ok — ${wanted.length} ids resolved`);
