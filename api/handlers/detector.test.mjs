/**
 * Self-check: node api/handlers/detector.test.mjs
 *
 * The part worth pinning is that the verdict is composed on the way out and
 * never stored: ai_club must survive untouched however the gate rules, and
 * the same rows must answer differently as the threshold moves.
 */
import assert from "node:assert";
import { handleDetector } from "./detector.js";

const fakeEnv = (rows, vars = {}) => ({
  ...vars,
  DB: {
    prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }), all: async () => ({ results: rows }) }),
  },
});

const row = (over = {}) => ({
  cover_id: 1, newspaper: "record", date: "2026-09-14", human_club: "others",
  url: "u", thumb_url: "t",
  ai_club: "benfica", ai_headline: "AGRIDOCE", ai_why: "Benfica",
  ai_owns: "yes", ai_source: "model",
  lr_benfica: 0.01, lr_porto: 0.005, lr_sporting: 0.005, lr_others: 0.98,
  lr_asof: "2026-09-01", ...over,
});

const get = (rows, vars, qs = "") =>
  handleDetector(new Request(`https://x/detector${qs}`), fakeEnv(rows, vars)).then(r => r.json());

// Over the line: the card shows others, the model's own answer is still there.
{
  const body = await get([row()], { LR_GATE_THRESHOLD: "0.8" });
  assert.equal(body.covers[0].club, "others");
  assert.equal(body.covers[0].model_club, "benfica", "ai_club must never be overwritten");
  assert.equal(body.covers[0].source, "gate");
  assert.equal(body.threshold, 0.8);
  assert.equal(body.gated, 1);
  assert.equal(body.agreement, 1, "gated cover now matches the crowd");
  assert.equal(body.latest.winner, "others");
}

// Same row, higher bar: the model's answer stands. This is the whole point of
// resolving at read time — one stored row, two answers.
{
  const body = await get([row()], { LR_GATE_THRESHOLD: "0.99" });
  assert.equal(body.covers[0].club, "benfica");
  assert.equal(body.covers[0].source, "model");
  assert.equal(body.gated, 0);
  assert.equal(body.agreement, 0);
}

// ?threshold= overrides the deployment's own setting, for exploring only.
{
  const body = await get([row()], { LR_GATE_THRESHOLD: "0.99" }, "?threshold=0.5");
  assert.equal(body.threshold, 0.5);
  assert.equal(body.covers[0].club, "others");
}
{
  const res = await handleDetector(new Request("https://x/detector?threshold=7"), fakeEnv([row()]));
  assert.equal(res.status, 400);
}

// No threshold configured at all: the gate is off, nothing is rewritten.
{
  const body = await get([row()], {});
  assert.equal(body.threshold, null);
  assert.equal(body.covers[0].club, "benfica");
}

// Consensus covers are exempt however high the probability: no model answered,
// and the label already came from the crowd the gate is trying to predict.
{
  const body = await get([row({ ai_source: "consensus", ai_owns: null, ai_club: "porto" })], { LR_GATE_THRESHOLD: "0.5" });
  assert.equal(body.covers[0].club, "porto");
  assert.equal(body.covers[0].source, "consensus");
}

// A cover with no headline vector has no LR score; the gate stays shut and
// `lr` is null rather than a row of zeroes that would read as certainty.
{
  const body = await get([row({ lr_benfica: null, lr_porto: null, lr_sporting: null, lr_others: null, lr_asof: null })],
    { LR_GATE_THRESHOLD: "0.5" });
  assert.equal(body.covers[0].club, "benfica");
  assert.equal(body.covers[0].lr, null);
}

// The day's verdict counts gated labels, not stored ones.
{
  const body = await get([
    row({ cover_id: 1, newspaper: "record" }),
    row({ cover_id: 2, newspaper: "abola", lr_others: 0.95 }),
    row({ cover_id: 3, newspaper: "ojogo", ai_club: "porto", lr_others: 0.1, lr_benfica: 0.1, lr_porto: 0.8, human_club: "porto" }),
  ], { LR_GATE_THRESHOLD: "0.8" });
  assert.deepEqual(body.covers.map(c => c.club), ["others", "others", "porto"]);
  assert.equal(body.latest.winner, "others");
  assert.equal(body.latest.confidence, 2 / 3);
  assert.equal(body.gated, 2);
}

// Nothing classified yet: no verdict rather than a made-up one.
{
  const body = await get([], { LR_GATE_THRESHOLD: "0.8" });
  assert.equal(body.latest, null);
  assert.equal(body.agreement, null);
  assert.equal(body.labelled, 0);
}

console.log("detector: ok");
