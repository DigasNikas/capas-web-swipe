/**
 * Self-check for the answer parser: node api/lib/ai.test.mjs
 *
 * The parser is the whole safety net. Every case below is a reply the model
 * actually produced at some point, or the failure mode the old parser turned
 * into a confident wrong label.
 */
import assert from "node:assert";
import { parseAnswer } from "./ai.js";

// Happy path, old two-line shape (no WHY: line) — why comes back null.
assert.deepEqual(
  parseAnswer("HEADLINE: MEIO BILHETE\nANSWER: benfica"),
  { club: "benfica", headline: "MEIO BILHETE", why: null },
);

// Happy path, current three-line shape.
assert.deepEqual(
  parseAnswer("HEADLINE: MEIO BILHETE\nWHY: Benfica named in the headline\nANSWER: benfica"),
  { club: "benfica", headline: "MEIO BILHETE", why: "Benfica named in the headline" },
);

// Case and stray punctuation around the club word.
assert.equal(parseAnswer("HEADLINE: X\nAnswer: **Sporting**").club, "sporting");

// No marker at all: abstain. The old parser scanned the whole reply and
// answered benfica here, because benfica is first in CLUBS.
assert.deepEqual(
  parseAnswer("The page is dominated by a Sporting win over Porto."),
  { club: null, headline: null, why: null },
);

// Truncated before the marker — max_tokens ran out. Same rule: no label.
assert.equal(parseAnswer("HEADLINE: LEAO RUGE EM ALVALADE E O BENFICA").club, null);

// Position, not CLUBS order. Both names appear after the marker; the first one
// wins. The old parser returned benfica for this.
assert.equal(parseAnswer("ANSWER: porto (not benfica)").club, "porto");

// A club named in the headline must not leak into the answer.
assert.equal(parseAnswer("HEADLINE: BENFICA HUMILHADO\nANSWER: others").club, "others");

// Model echoed the instruction line before answering: take the last marker.
assert.equal(
  parseAnswer("ANSWER: <benfica|sporting|porto|others>\nHEADLINE: DRAGAO VOA\nANSWER: porto").club,
  "porto",
);

// Junk in, null out — never throw, the daily scrape depends on it.
assert.deepEqual(parseAnswer(null), { club: null, headline: null, why: null });
assert.deepEqual(parseAnswer(undefined), { club: null, headline: null, why: null });
assert.equal(parseAnswer("ANSWER: liverpool").club, null);

console.log("ai parser ok");
