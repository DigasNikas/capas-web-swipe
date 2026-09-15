import { json } from "../lib/http.js";
import { applyGate, gateThreshold } from "../lib/gate.js";
import { verdict } from "../lib/verdict.js";

const PAPER_NAMES = { abola: "A Bola", ojogo: "O Jogo", record: "Record" };

// GET /detector?threshold= (public). Everything the AI Detector card shows,
// composed here rather than in the dashboard.
//
// The verdict a cover displays is not a stored column. ai_club is the vision
// model's own answer and stays that way for the life of the row; the `others`
// gate (api/lib/gate.js) is applied on the way out. That is what makes the
// threshold retroactive — change LR_GATE_THRESHOLD and every past verdict
// moves with it, instead of only covers classified afterwards — and it means
// no verdict is ever lost behind an overwrite.
//
// Split out of /stats deliberately. /stats is the crowd's numbers and a
// 600KB archive dump that changes once a day; this changes when classify runs
// and again whenever the threshold does. Same handler meant one cache entry
// for three different change rates.
export async function handleDetector(request, env) {
  const url = new URL(request.url);

  // ?threshold= overrides the deployed LR_GATE_THRESHOLD for this response
  // only. Nothing is written, so this is free to explore with: it answers
  // "what would 0.9 do" without touching what anyone else sees.
  const override = url.searchParams.get("threshold");
  let threshold = gateThreshold(env);
  if (override !== null) {
    const n = Number(override);
    if (!Number.isFinite(n) || n <= 0 || n > 1) {
      return json({ error: "threshold must be a number in (0, 1]" }, 400);
    }
    threshold = n;
  }

  const { results: rows } = await env.DB
    .prepare(`
      SELECT ac.cover_id, ac.newspaper, ac.date, ac.club AS human_club,
             c.url, COALESCE(c.thumb_url, c.url) AS thumb_url,
             c.ai_club, c.ai_headline, c.ai_why, c.ai_owns, c.ai_source,
             c.lr_benfica, c.lr_porto, c.lr_sporting, c.lr_others, c.lr_asof
      FROM analytics_covers ac
      JOIN covers c ON c.id = ac.cover_id
      -- Unclassified covers are absent rather than counted as misses: a paper
      -- the backfill has not reached yet must not drag the day's verdict down.
      -- Enforced here in SQL, which is why detector.test.mjs cannot exercise
      -- it through the D1 stub.
      WHERE c.ai_club IS NOT NULL
      ORDER BY ac.date ASC
    `)
    .all();

  const covers = rows.map(r => {
    const lr = r.lr_others === null ? null : {
      benfica: r.lr_benfica, porto: r.lr_porto,
      sporting: r.lr_sporting, others: r.lr_others, asof: r.lr_asof,
    };
    // The consensus fast path never asked a model, so there is no model
    // answer to second-guess — and its label already comes from the crowd,
    // which is what the gate is trying to predict.
    const gated = r.ai_source === "consensus"
      ? { club: r.ai_club, source: "consensus" }
      : applyGate({ club: r.ai_club, owns: r.ai_owns }, lr, threshold);

    return {
      cover_id: r.cover_id,
      newspaper: r.newspaper,
      name: PAPER_NAMES[r.newspaper],
      date: r.date,
      url: r.url,
      thumb_url: r.thumb_url,
      club: gated.club,           // what the card shows
      model_club: r.ai_club,      // what Llama answered, always preserved
      source: gated.source,       // model | consensus | gate
      human_club: r.human_club,
      headline: r.ai_headline || null,
      why: r.ai_why || null,
      owns: r.ai_owns,
      lr,
    };
  });

  let latest = null;
  if (covers.length > 0) {
    const latestDate = covers[covers.length - 1].date;
    const latestCovers = covers.filter(c => c.date === latestDate);
    latest = { date: latestDate, ...verdict(latestCovers, "club"), covers: latestCovers };
  }

  return json({
    // Echoed so a surprising agreement figure is traceable to the threshold
    // that produced it, rather than to a secret nobody remembers setting.
    threshold,
    labelled: covers.length,
    // Headline number of the whole feature: how often the displayed verdict
    // landed on the same club as the crowd. Moves with the threshold.
    agreement: covers.length
      ? covers.filter(c => c.club === c.human_club).length / covers.length
      : null,
    gated: covers.filter(c => c.source === "gate").length,
    latest,
    covers,
  });
}
