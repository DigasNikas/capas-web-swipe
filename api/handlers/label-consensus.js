import { json, requireAdmin } from "../lib/http.js";
import { CLUBS, CONSENSUS_MIN } from "../lib/ai.js";

// POST /label-consensus (admin, bearer-protected). Body: {cover_id, club,
// agreed, of, rag_cover_ids}. Records a label the RAG neighbours agreed on
// without any model call.
//
// The counterpart to /reclassify-rag, which stays the one place Llama4 runs.
// scripts/rag_classify.py decides which of the two a cover goes to: when
// CONSENSUS_MIN or more of the retrieved neighbours carry the same crowd
// label, the neighbours are right 95% of the time (better than the
// classifier's own 91.2%), so the call is not worth its neurons — see
// consensusClub in lib/ai.js for the measurement behind that.
//
// The threshold is re-checked here rather than trusted from the caller. A
// script bug that sent a 4-of-7 majority would otherwise write labels that
// are right 69% of the time, and nothing downstream would notice.
export async function handleLabelConsensus(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { cover_id, club, agreed, of, rag_cover_ids } = body;
  if (!cover_id) return json({ error: "cover_id required" }, 400);
  if (!CLUBS.includes(club)) return json({ error: `club must be one of ${CLUBS.join(", ")}` }, 400);
  if (!Number.isInteger(agreed) || agreed < CONSENSUS_MIN) {
    return json({ error: `agreed must be at least ${CONSENSUS_MIN}` }, 400);
  }

  await env.DB
    .prepare("UPDATE covers SET ai_club = ?, ai_headline = ?, ai_why = ?, ai_rag_covers = ?, ai_source = ? WHERE id = ?")
    // ai_headline is "" because nothing read the image to quote from it, and
    // NULL there means "classified by an older prompt, retry me" (see
    // classifyAndStore). ai_why carries the margin, so a wrong consensus
    // label can be traced to how thin its majority was.
    .bind(
      club,
      "",
      `${agreed} of ${of ?? agreed} similar covers were crowd-labelled ${club}`,
      JSON.stringify(rag_cover_ids ?? []),
      "consensus",
      cover_id,
    )
    .run();

  return json({ ok: true, cover_id, club });
}
