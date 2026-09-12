/**
 * Self-check for the calendar's 🚨 wording: node dashboard/pulse.test.mjs
 *
 * The alert accuses papers of ignoring a club, so it has to say why that is
 * unfair: the club was the only one playing, and in which competition.
 */
import assert from 'node:assert';
import { pulseMessage } from './src/pulse.js';

// One club played, and we know the competition: the whole point of the alert.
assert.equal(
  pulseMessage(['Porto'], { onlyOne: true, competition: 'Champions League' }),
  'Porto foi o único a jogar Champions League ontem e não foi mencionado por todos',
);

// Matches imported before the competition column existed.
assert.equal(
  pulseMessage(['Porto'], { onlyOne: true, competition: null }),
  'Porto foi o único a jogar ontem e não foi mencionado por todos',
);

// More than one club played, so "o único" would be a lie.
assert.equal(
  pulseMessage(['Benfica'], { onlyOne: false, competition: 'Primeira Liga' }),
  'Benfica jogou ontem e não foi mencionado por todos',
);

// Two clubs ignored on the same day: plural all the way through.
assert.equal(
  pulseMessage(['Benfica', 'Porto'], { onlyOne: false, competition: null }),
  'Benfica e Porto jogaram ontem e não foram mencionados por todos',
);

assert.equal(
  pulseMessage(['Benfica', 'Porto', 'Sporting'], { onlyOne: false, competition: null }),
  'Benfica, Porto e Sporting jogaram ontem e não foram mencionados por todos',
);

console.log('pulse: ok');
