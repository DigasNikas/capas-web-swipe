/**
 * Self-check: node dashboard/divided.test.mjs
 *
 * The arithmetic behind the bar. Rendering needs a DOM, but these three are
 * what decide whether a cover's split is drawn honestly.
 */
import assert from 'node:assert';
import { ALWAYS_VISIBLE, segments, shortDate, winnerShare } from './src/divided.js';

const cover = (votes, total) => ({ votes, votes_total: total, votes_club: Math.max(...Object.values(votes)) });

// A dead heat: the winner holds under half the votes.
assert.equal(winnerShare(cover({ benfica: 1, sporting: 10, porto: 0, others: 10 }, 21)), 48);

// Only clubs with a vote get a segment, in a fixed order, and the widths add
// up to the whole bar.
{
  const segs = segments(cover({ benfica: 1, sporting: 10, porto: 0, others: 10 }, 21));
  assert.deepEqual(segs.map(s => s.club), ['benfica', 'sporting', 'others']);
  assert.deepEqual(segs.map(s => s.votes), [1, 10, 10]);
  assert.ok(Math.abs(segs.reduce((sum, s) => sum + s.pct, 0) - 100) < 1e-9, 'the bar is full');
}

// One club taking every vote still draws a full bar, not an empty one.
{
  const segs = segments(cover({ benfica: 0, sporting: 0, porto: 6, others: 0 }, 6));
  assert.deepEqual(segs.map(s => [s.club, s.pct]), [['porto', 100]]);
}

assert.equal(shortDate('2026-09-08'), '8 set');
assert.equal(shortDate('2026-01-31'), '31 jan');

assert.equal(ALWAYS_VISIBLE, 2);

console.log('divided: ok');
