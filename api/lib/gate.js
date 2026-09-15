// The `others` gate: a logistic regression over the two stored embeddings
// overrides the model when it names a club on a page nobody owns.
//
// Measured on 113 model-classified covers, agreement with the crowd went from
// 80.5% to 90.3% at a threshold of 0.80 -- twelve corrections against one new
// error. The model's whole error budget sits in that one class, which it
// answers with a club far more often than not; the LR reads what the page
// *says* (which clubs it names) alongside what it *shows*, and that is the
// combination a shared page needs. Neither embedding alone works: 70% and 66%
// on their own, 81% concatenated.
//
// One direction only. The gate can turn a club into `others` and never the
// reverse, and never swaps one club for another -- the LR's argmax is worse
// than the model's on the club classes, and its high-confidence club errors
// are its ugliest failures. Bounding it this way means the worst case is a
// handful of wrongly-shared pages, not a reshuffled archive.
export const GATE_SOURCE = "gate";

// Unset means off. A missing or unparseable LR_GATE_THRESHOLD leaves the
// model's answer alone rather than picking a default nobody chose -- this is
// a behaviour change on live labels, so it should take an explicit number.
export function gateThreshold(env) {
  const raw = env?.LR_GATE_THRESHOLD;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : null;
}

// The model's verdict, possibly overridden. Returns the label to store and
// which source produced it.
//
// owns === "yes" is part of the condition on purpose: a reply that already
// doubts single ownership needs no second opinion, and `OWNS: no` covers are
// the ones the model gets right unaided. Firing only on "yes" keeps the gate
// pointed at the failure it was built for.
export function applyGate({ club, owns }, probabilities, threshold) {
  const p = probabilities?.others;
  const fires = threshold !== null && threshold !== undefined
    && typeof p === "number" && Number.isFinite(p)
    && club && club !== "others"
    && owns === "yes"
    && p >= threshold;
  return fires ? { club: "others", source: GATE_SOURCE } : { club, source: "model" };
}
