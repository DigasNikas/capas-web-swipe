/**
 * Self-check: node api/handlers/similarities.test.mjs
 *
 * The pairing is the part worth pinning: ai_rag_covers and ai_rag_source are
 * two JSON arrays kept in step by position, and /similarities' channel filter
 * is only as honest as that alignment.
 */
import assert from "node:assert";
import { handleSimilarities } from "./similarities.js";

const fakeEnv = (covers, refs) => ({
  DB: {
    prepare(sql) {
      const stmt = {
        bind: () => stmt,
        all: async () => ({ results: sql.includes("ai_rag_covers") ? covers : refs }),
      };
      return stmt;
    },
  },
});

const cover = (over = {}) => ({
  id: 1, newspaper: "record", date: "2026-01-01", url: "u", thumb_url: "t",
  ai_club: "porto", ai_headline: "DRAGAO VOA",
  ai_rag_covers: '["7","8"]', ai_rag_source: '["headline","layout"]', ...over,
});
const refs = [
  { id: 7, newspaper: "abola", date: "2025-05-05", url: "u7", thumb_url: "t7", ai_club: "porto", club: "porto" },
  { id: 8, newspaper: "ojogo", date: "2025-06-06", url: "u8", thumb_url: "t8", ai_club: "benfica", club: "benfica" },
];

{
  const [row] = await handleSimilarities(fakeEnv([cover()], refs)).then(r => r.json());
  assert.deepEqual(row.ragCovers.map(c => [c.id, c.via]), [[7, "headline"], [8, "layout"]]);
  assert.equal(row.ai_rag_covers, undefined, "raw JSON columns stay server-side");
  assert.equal(row.ai_rag_source, undefined);
}

// A row from before ai_rag_source existed still renders; every match reads as
// a layout match, which is the only channel there was then.
{
  const [row] = await handleSimilarities(fakeEnv([cover({ ai_rag_source: null })], refs)).then(r => r.json());
  assert.deepEqual(row.ragCovers.map(c => c.via), ["layout", "layout"]);
}

// Two columns of different lengths must not shift a channel onto the wrong
// cover: the ids lead, and anything unaccounted for is layout.
{
  const [row] = await handleSimilarities(fakeEnv([cover({ ai_rag_source: '["headline"]' })], refs)).then(r => r.json());
  assert.deepEqual(row.ragCovers.map(c => [c.id, c.via]), [[7, "headline"], [8, "layout"]]);
}

// A referenced cover that no longer resolves drops out without dragging its
// neighbour's channel with it.
{
  const [row] = await handleSimilarities(fakeEnv([cover()], [refs[1]])).then(r => r.json());
  assert.deepEqual(row.ragCovers.map(c => [c.id, c.via]), [[8, "layout"]]);
}

console.log("similarities: ok");
