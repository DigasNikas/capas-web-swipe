/**
 * Self-check for the calendar's 🚨 wording: node dashboard/pulse.test.mjs
 *
 * The alert accuses papers of ignoring a club, so it has to say why that is
 * unfair: the club was the only one playing, and in which competition. Not
 * "mencionado" — every cover mentions all three clubs somewhere; the vote is
 * about which one is the page's lead story.
 */
import assert from 'node:assert';
import { pulseMessage } from './src/pulse.js';

// One club played, and we know the competition: the whole point of the alert.
assert.equal(
  pulseMessage(['Porto'], { onlyOne: true, competition: 'Champions League' }),
  'Porto foi o único a jogar Champions League ontem e não foi manchete em todas as capas',
);

// Matches imported before the competition column existed.
assert.equal(
  pulseMessage(['Porto'], { onlyOne: true, competition: null }),
  'Porto foi o único a jogar ontem e não foi manchete em todas as capas',
);

// More than one club played, so "o único" would be a lie. On those days a club
// is only flagged when no cover mentioned it at all (see snubInfoFor), so the
// sentence says that rather than "por todos".
assert.equal(
  pulseMessage(['Benfica'], { onlyOne: false, competition: 'Primeira Liga' }),
  'Benfica jogou ontem e não foi manchete em nenhuma capa',
);

// Two clubs ignored on the same day: plural all the way through.
assert.equal(
  pulseMessage(['Benfica', 'Porto'], { onlyOne: false, competition: null }),
  'Benfica e Porto jogaram ontem e não foram manchete em nenhuma capa',
);

assert.equal(
  pulseMessage(['Benfica', 'Porto', 'Sporting'], { onlyOne: false, competition: null }),
  'Benfica, Porto e Sporting jogaram ontem e não foram manchete em nenhuma capa',
);

console.log('pulse: ok');
