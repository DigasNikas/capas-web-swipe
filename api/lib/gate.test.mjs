/**
 * Self-check: node api/lib/gate.test.mjs
 */
import assert from "node:assert";
import { applyGate, gateThreshold } from "./gate.js";

// Threshold parsing: only an explicit number in (0, 1] turns the gate on.
assert.strictEqual(gateThreshold({ LR_GATE_THRESHOLD: "0.8" }), 0.8);
assert.strictEqual(gateThreshold({ LR_GATE_THRESHOLD: "1" }), 1);
assert.strictEqual(gateThreshold({}), null, "unset means off");
assert.strictEqual(gateThreshold({ LR_GATE_THRESHOLD: "" }), null);
assert.strictEqual(gateThreshold({ LR_GATE_THRESHOLD: "off" }), null);
assert.strictEqual(gateThreshold({ LR_GATE_THRESHOLD: "0" }), null, "0 would fire on every cover");
assert.strictEqual(gateThreshold({ LR_GATE_THRESHOLD: "1.5" }), null);
assert.strictEqual(gateThreshold(undefined), null);

const probs = o => ({ benfica: 0.1, porto: 0.1, sporting: 0.1, others: o });

// Fires: the model named a club, claimed one club owns the page, and the LR
// is over the line. This is 2026-09-14 record -- "Famalicao 1-1 Sporting.
// Benfica 3-1 Gil Vicente. Rivais de Lisboa acabaram com sortes diferentes".
assert.deepStrictEqual(
  applyGate({ club: "benfica", owns: "yes" }, probs(0.98), 0.8),
  { club: "others", source: "gate" },
);

// Exactly at the threshold counts.
assert.deepStrictEqual(
  applyGate({ club: "benfica", owns: "yes" }, probs(0.8), 0.8),
  { club: "others", source: "gate" },
);

// Below it, the model's answer stands. This is the Porto-Torreense Supertaca
// pair on A Bola, the gate's two known losses, both under 0.9.
assert.deepStrictEqual(
  applyGate({ club: "porto", owns: "yes" }, probs(0.808), 0.9),
  { club: "porto", source: "model" },
);

// OWNS: no is left alone -- the model already doubts single ownership there.
assert.deepStrictEqual(
  applyGate({ club: "sporting", owns: "no" }, probs(0.99), 0.8),
  { club: "sporting", source: "model" },
);

// Never the reverse direction, and never club-to-club.
assert.deepStrictEqual(
  applyGate({ club: "others", owns: "yes" }, probs(0.99), 0.8),
  { club: "others", source: "model" },
);
assert.deepStrictEqual(
  applyGate({ club: "benfica", owns: "yes" }, { ...probs(0.01), porto: 0.97 }, 0.8),
  { club: "benfica", source: "model" },
  "a confident LR club prediction must not override the model",
);

// No threshold, no probability, or a garbage probability: gate stays shut.
assert.deepStrictEqual(applyGate({ club: "benfica", owns: "yes" }, probs(0.99), null),
  { club: "benfica", source: "model" });
assert.deepStrictEqual(applyGate({ club: "benfica", owns: "yes" }, null, 0.8),
  { club: "benfica", source: "model" });
assert.deepStrictEqual(applyGate({ club: "benfica", owns: "yes" }, probs(NaN), 0.8),
  { club: "benfica", source: "model" });

// A cover with no headline vector has no LR score at all -- rag_classify.py
// sends nothing, and the model's answer stands.
assert.deepStrictEqual(applyGate({ club: "porto", owns: "yes" }, undefined, 0.8),
  { club: "porto", source: "model" });

console.log("ok");
