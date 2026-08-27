/**
 * Self-check for the answer parser: node api/lib/ai.test.mjs
 *
 * The parser is the whole safety net. Every case below is a reply the model
 * actually produced at some point, or the failure mode the old parser turned
 * into a confident wrong label.
 */
import assert from "node:assert";
import { parseAnswer, buildFewShotBlock } from "./ai.js";

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

// Junk in, null out — never throw, rag-classify.yml's daily run depends on it.
assert.deepEqual(parseAnswer(null), { club: null, headline: null, why: null });
assert.deepEqual(parseAnswer(undefined), { club: null, headline: null, why: null });
assert.equal(parseAnswer("ANSWER: liverpool").club, null);

// No matches: no few-shot block, prompt stays exactly the zero-shot baseline.
assert.equal(buildFewShotBlock([]), "");
assert.equal(buildFewShotBlock(undefined), "");

// Matches with no usable label are dropped, not counted as signal.
assert.equal(buildFewShotBlock([{ metadata: {} }, { metadata: { club: null } }]), "");

// Real matches: every club listed, in order, and the layout-bias caveat present.
{
  const block = buildFewShotBlock([
    { metadata: { club: "sporting" } },
    { metadata: { club: "sporting" } },
    { metadata: { club: "benfica" } },
  ]);
  assert.ok(block.includes("sporting, sporting, benfica"), "lists every club in order");
  assert.ok(block.includes("weak prior"), "carries the layout-bias caveat");
}

// Self-vote leakage: a cover already in the index matches itself at
// ~0.99999. That near-identical hit must never leak its own crowd vote back
// into its own few-shot context (scripts/rag_classify.py re-embeds and
// reclassifies covers that are already indexed, both in live and --eval mode).
assert.equal(
  buildFewShotBlock([{ metadata: { club: "benfica" }, score: 0.99999 }]),
  "",
  "a near-identical self-match alone produces no few-shot block",
);
{
  const block = buildFewShotBlock([
    { metadata: { club: "benfica" }, score: 0.99999 },
    { metadata: { club: "sporting" }, score: 0.87 },
    { metadata: { club: "porto" }, score: 0.81 },
  ]);
  assert.ok(!block.includes("benfica"), "self-match's club is excluded, not just deprioritized");
  assert.ok(block.includes("sporting, porto"), "genuinely different matches still count");
}

console.log("ai.js self-check ok");
