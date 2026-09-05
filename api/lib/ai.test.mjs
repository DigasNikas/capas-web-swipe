/**
 * Self-check for the answer parser: node api/lib/ai.test.mjs
 *
 * The parser is the whole safety net. Every case below is a reply the model
 * actually produced at some point, or the failure mode the old parser turned
 * into a confident wrong label.
 */
import assert from "node:assert";
import {
  parseAnswer, buildFewShotBlock, ragCoverIdsFromMatches,
  buildHeadlinesBlock, classifyCover, classifyAndStore, consensusClub,
  ragSourcesFromMatches, PROMPT,
} from "./ai.js";

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

// Real matches: a tally rather than a list, the channel breakdown, and the
// caveat. A tally is what the model can actually act on — "3 benfica" reads
// as a majority, "benfica, benfica, sporting, benfica" reads as noise.
{
  const block = buildFewShotBlock([
    { metadata: { club: "sporting" }, via: "layout" },
    { metadata: { club: "sporting" }, via: "headline" },
    { metadata: { club: "benfica" }, via: "layout" },
  ]);
  assert.ok(block.includes("2 sporting, 1 benfica"), "tallied, most common first");
  assert.ok(block.includes("1 matched by headline wording, 2 by page layout"));
  assert.ok(block.includes("weak prior"), "carries the caveat");
}

// Ties are broken by CLUBS order, not by whichever the retrieval happened to
// return first: the same neighbours must always produce the same prompt, or
// two --eval runs over one sample stop being comparable.
{
  const a = buildFewShotBlock([{ metadata: { club: "porto" } }, { metadata: { club: "benfica" } }]);
  const b = buildFewShotBlock([{ metadata: { club: "benfica" } }, { metadata: { club: "porto" } }]);
  assert.equal(a, b);
  assert.ok(a.includes("1 benfica, 1 porto"));
}

// One channel only — the archive's state until the headline index fills, and
// the permanent state for a cover with no scraped headlines.
{
  const block = buildFewShotBlock([
    { metadata: { club: "porto" }, via: "layout" },
    { metadata: { club: "porto" }, via: "layout" },
  ]);
  assert.ok(block.includes("both matched by page layout"), "no empty 0-by-headline clause");
  assert.ok(!block.includes("headline wording"));
}
{
  const block = buildFewShotBlock([{ metadata: { club: "porto" }, via: "headline" }]);
  assert.ok(block.includes("matched by headline wording"));
}

// An unlabelled via is treated as layout: that is what every vector in the
// image index predates the second channel as.
{
  const block = buildFewShotBlock([{ metadata: { club: "benfica" } }]);
  assert.ok(block.includes("page layout"));
}

// ragCoverIdsFromMatches mirrors buildFewShotBlock's filter exactly — same
// inputs should drop the same matches (no club, self-match at score >= 0.999).
assert.deepEqual(ragCoverIdsFromMatches([]), []);
assert.deepEqual(ragCoverIdsFromMatches(undefined), []);
assert.deepEqual(ragCoverIdsFromMatches([{ id: "1", metadata: {} }]), []);
assert.deepEqual(
  ragCoverIdsFromMatches([{ id: "1", metadata: { club: "benfica" }, score: 0.99999 }]),
  [],
  "a near-identical self-match contributes no id, same as no club text",
);
assert.deepEqual(
  ragCoverIdsFromMatches([
    { id: "1", metadata: { club: "benfica" }, score: 0.99999 },
    { id: "2", metadata: { club: "sporting" }, score: 0.87 },
    { id: "3", metadata: { club: "porto" }, score: 0.81 },
  ]),
  ["2", "3"],
  "ids line up with the same matches buildFewShotBlock's text is built from",
);

// --- buildHeadlinesBlock ---
//
// covers.headlines is the real scraped front-page text (see headlines.md), so
// the model no longer has to OCR what we already know. Nothing to say when a
// cover has none: 383 of 1821 covers were never reached by either backfill,
// and every past-date scrape leaves the column NULL, so "" is the common case
// for the archive, not an error.
assert.equal(buildHeadlinesBlock(null), "");
assert.equal(buildHeadlinesBlock(undefined), "");
assert.equal(buildHeadlinesBlock(""), "");
assert.equal(buildHeadlinesBlock("   \n  "), "");

{
  const block = buildHeadlinesBlock("Palhinha ja e da casa • Zaidu com suspeita de lesao");
  assert.ok(block.includes("Palhinha ja e da casa • Zaidu com suspeita de lesao"));
  // The guard is the whole reason this is safe to add. headlines is every
  // title on the page, side rails included, and the documented failure mode
  // of this classifier is exactly counting rail mentions (others recall 39%,
  // see the header of ai.js). Deleting this sentence turns the block into a
  // club-name tally.
  assert.ok(/does not decide the answer/.test(block), "the do-not-count-mentions guard survives");
  assert.ok(block.endsWith("\n\n"), "separated from the prompt that follows it");
}

// Scraped text arrives with the source page's own line breaks in it; collapse
// them so one cover cannot reshape the prompt's layout.
assert.ok(buildHeadlinesBlock("Dragoes\n\npasseiam   na Beira").includes("Dragoes passeiam na Beira"));

{
  // Bounded on purpose: a full "Titulos da Capa" block runs past 1000 chars on
  // a busy page, all of it tail-end rail teasers by then. The dominant story
  // is at the top of the list, so the tail is what gets dropped.
  const long = `${"cabecalho ".repeat(200)}FIMDOTEXTO`;
  const block = buildHeadlinesBlock(long);
  assert.ok(!block.includes("FIMDOTEXTO"), "tail is dropped, not sent");
  assert.ok(block.includes("…"), "truncation is visible to the model, not silent");
  assert.ok(block.length < long.length, "block is shorter than the raw text");
}

// --- classifyCover threads the block into the prompt ---

const fakeAi = (capture, response = "ANSWER: benfica") => ({
  AI: { run: async (_model, body) => { capture.push(body); return { response }; } },
});
const buf = new Uint8Array([1, 2, 3]).buffer;

{
  // No headlines, no few-shot: the prompt is byte-identical to the zero-shot
  // baseline every number in ai.js's header was measured against.
  const sent = [];
  await classifyCover(fakeAi(sent), buf);
  assert.equal(sent[0].messages[0].content[0].text, PROMPT);
}

{
  const sent = [];
  await classifyCover(fakeAi(sent), buf, "image/jpeg", "REF. ", "Aguias voam alto");
  const text = sent[0].messages[0].content[0].text;
  assert.ok(text.startsWith("REF. "), "few-shot context still comes first");
  assert.ok(text.includes("Aguias voam alto"));
  assert.ok(text.endsWith(PROMPT), "the instructions stay last, next to the image");
}

// --- classifyAndStore reads headlines from D1 itself ---
//
// Not sent in by rag_classify.py the way fewShot is: fewShot has to be built
// outside the Worker (no CLIP in Workers AI), headlines is a column already
// sitting next to the row this function updates. One read, no round trip, and
// no way for the script to send text that disagrees with what is stored.

const fakeEnv = ({ headlines = null, capture = [] } = {}) => ({
  ...fakeAi(capture),
  COVERS_BUCKET: { get: async () => ({ arrayBuffer: async () => buf, httpMetadata: {} }) },
  DB: {
    prepare(sql) {
      return {
        bind: () => ({
          first: async () => (sql.includes("SELECT headlines") ? { headlines } : null),
          run: async () => ({ success: true }),
        }),
      };
    },
  },
});

{
  const capture = [];
  assert.equal(await classifyAndStore(fakeEnv({ headlines: "Leao ruge em Alvalade", capture }), 1, "k"), "benfica");
  assert.ok(capture[0].messages[0].content[0].text.includes("Leao ruge em Alvalade"));
}

{
  // The archive's common case. A cover with no scraped headlines still gets
  // classified, on the image alone, exactly as before this existed.
  const capture = [];
  assert.equal(await classifyAndStore(fakeEnv({ capture }), 1, "k"), "benfica");
  assert.equal(capture[0].messages[0].content[0].text, PROMPT);
}


// --- consensusClub ---
//
// The fast path: when this many of the retrieved neighbours carry the same
// crowd label, that label is written directly and the Llama4 call is skipped.
// Measured over all 1836 crowd-labelled covers, by size of the winning bloc:
// 7/7 is right 96% of the time, 6/7 94%, 5/7 85%, 4/7 69%. 6 is the cut
// because it is the last band that beats the model's own 91.2%.

assert.equal(consensusClub([]), null);
assert.equal(consensusClub(undefined), null);

// Six of seven agreeing is enough; the seventh disagreeing changes nothing.
assert.deepEqual(
  consensusClub([
    ...Array(6).fill({ metadata: { club: "porto" } }),
    { metadata: { club: "benfica" } },
  ]),
  { club: "porto", agreed: 6, of: 7 },
);

// Five of seven is where accuracy falls to 85%, below the model. No shortcut.
assert.equal(
  consensusClub([
    ...Array(5).fill({ metadata: { club: "porto" } }),
    { metadata: { club: "benfica" } },
    { metadata: { club: "sporting" } },
  ]),
  null,
);

// A short neighbour list can still qualify: six of six is stronger evidence
// than six of seven, not weaker.
assert.deepEqual(
  consensusClub(Array(6).fill({ metadata: { club: "sporting" } })),
  { club: "sporting", agreed: 6, of: 6 },
);

// Filtered the same way the few-shot block is, so the two never disagree
// about which neighbours counted: a self-match contributes nothing, and six
// real neighbours plus a self-match is still six.
assert.equal(
  consensusClub(Array(7).fill({ metadata: { club: "porto" }, score: 0.99999 })),
  null,
  "self-matches cannot vote",
);
assert.deepEqual(
  consensusClub([
    ...Array(6).fill({ metadata: { club: "porto" } }),
    { metadata: { club: "porto" }, score: 0.99999 },
  ]),
  { club: "porto", agreed: 6, of: 6 },
);

// --- ragSourcesFromMatches ---
//
// Runs the same filter as ragCoverIdsFromMatches so the two arrays line up
// index for index: ai_rag_covers[i] was found by ai_rag_source[i]. Any drift
// between them mislabels which channel retrieved a cover on /similarities,
// silently and forever.
assert.deepEqual(ragSourcesFromMatches([]), []);
assert.deepEqual(ragSourcesFromMatches(undefined), []);

{
  const matches = [
    { id: "1", metadata: { club: "benfica" }, score: 0.99999, via: "headline" },
    { id: "2", metadata: {} , via: "headline" },
    { id: "3", metadata: { club: "sporting" }, score: 0.9, via: "headline" },
    { id: "4", metadata: { club: "porto" }, score: 0.8, via: "layout" },
  ];
  assert.deepEqual(ragCoverIdsFromMatches(matches), ["3", "4"]);
  assert.deepEqual(ragSourcesFromMatches(matches), ["headline", "layout"], "same matches, same order");
}

// A match with no via predates the second index and is a layout match.
assert.deepEqual(ragSourcesFromMatches([{ id: "1", metadata: { club: "porto" } }]), ["layout"]);

console.log("ai.js self-check ok");
