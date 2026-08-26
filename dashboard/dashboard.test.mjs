// Every element dashboard.js reaches for has to exist in index.html. There is
// no build step and no framework to catch a typo, so a renamed id fails
// silently in the browser — the section just never renders. This is that check.
//
//   node dashboard/dashboard.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const js = readFileSync(new URL('dashboard.js', dir), 'utf8');
const html = readFileSync(new URL('index.html', dir), 'utf8');

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

// Skip the template-literal ones (`${id}-covers`) — those are built at runtime
// from a prefix, and both prefixes are covered by the literal ids below.
const wanted = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
assert.ok(wanted.length > 10, 'no getElementById calls found — did the file move?');

const missing = wanted.filter(id => !ids.has(id));
assert.deepStrictEqual(missing, [], `dashboard.js reads ids that index.html does not define: ${missing}`);

// renderVerdict() is shared by the crowd's card and the model's; both show
// their own per-paper verdict as a covers strip. Guard the pair so a future
// edit can't drop one silently.
assert.ok(ids.has('latest-covers'), 'the crowd verdict lost its covers strip');
assert.ok(ids.has('ai-covers'), 'the model verdict lost its per-cover covers strip');

console.log(`ok — ${wanted.length} ids resolved`);
