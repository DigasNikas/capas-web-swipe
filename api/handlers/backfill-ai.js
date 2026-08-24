import { classifyAndStore } from "../lib/ai.js";

// One-off: labels covers scraped before the AI detector existed. Same shape as
// backfill-thumbs — bounded, synchronous batches so the response reflects what
// actually finished — but a much smaller batch, since each cover is a
// multi-second model call rather than an image transform. Newest first, so the
// section has something to show long before the whole archive is done.
//
// It doubles as the re-label path after a PROMPT change: covers classified by
// an older prompt have no ai_headline, so the same query picks them up and the
// same loop replaces them in place — no need to wipe ai_club first, the section
// keeps working while it runs. A cover the model will not answer for keeps its
// old label and stays in the queue, so if "done" stays below "attempted" every
// pass, that is a cover to look at rather than a loop to keep spinning.
// Call repeatedly until "remaining" is 0:
//
//   until curl -s -X POST -H "Authorization: Bearer <ADMIN_SECRET>" \
//     https://capas.digasnikas.com/api/backfill-ai | tee /dev/stderr | grep -q '"remaining":0'; do sleep 1; done
export async function handleBackfillAi(request, env) {
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { results: rows } = await env.DB
    .prepare("SELECT id, r2_key FROM covers WHERE ai_club IS NULL OR ai_headline IS NULL ORDER BY date DESC LIMIT 8")
    .all();

  let done = 0;
  for (const row of rows) {
    if (await classifyAndStore(env, row.id, row.r2_key)) done++;
  }

  const { results: [{ remaining }] } = await env.DB
    .prepare("SELECT COUNT(*) AS remaining FROM covers WHERE ai_club IS NULL OR ai_headline IS NULL")
    .all();

  return new Response(JSON.stringify({ done, attempted: rows.length, remaining }), {
    headers: { "Content-Type": "application/json" },
  });
}
