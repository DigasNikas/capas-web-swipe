/**
 * Self-check for the shared dashboard values: node dashboard/domain.test.mjs
 */
import assert from 'node:assert';
import { COMPETITION_NAMES, euroCompetition } from './src/domain.js';

const m = competition => ({ club: 'porto', competition });

// The covers of the morning after a European night get a frame. Which frame
// depends on the competition, and a domestic night gets none.
assert.equal(euroCompetition([m('CL')]), 'CL');
assert.equal(euroCompetition([m('EL')]), 'EL');
assert.equal(euroCompetition([m('UECL')]), 'UECL');
assert.equal(euroCompetition([m('PPL')]), null);
assert.equal(euroCompetition([m('TP')]), null);
assert.equal(euroCompetition([]), null);
assert.equal(euroCompetition([m(null)]), null, 'rows with no competition yet');

// Thursday's Europa League and Wednesday's Champions League can land on one
// date. The bigger competition sets the frame.
assert.equal(euroCompetition([m('EL'), m('CL')]), 'CL');
assert.equal(euroCompetition([m('PPL'), m('UECL')]), 'UECL');

// Every competition a match can carry has a display name.
for (const code of ['CL', 'EL', 'UECL', 'PPL', 'TP', 'TL']) {
  assert.ok(COMPETITION_NAMES[code], `${code} has a name`);
}

console.log('domain: ok');
