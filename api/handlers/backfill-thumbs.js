import { json, requireAdmin } from "../lib/http.js";
import { generateThumbnail } from "../lib/scraper.js";

// One-off: generates thumb_url for covers scraped before thumbnails existed.
// Processes a bounded batch per call and runs synchronously (no ctx.waitUntil)
// so the response always reflects what actually finished — a full run of
// 1000+ covers blows past Workers' execution limits if done in one shot, and
// a fire-and-forget background loop would just die silently past that point
// with no way to tell it happened. Call repeatedly until "remaining" is 0:
//
//   until curl -s -X POST -H "Authorization: Bearer <ADMIN_SECRET>" \
//     https://capas.digasnikas.com/api/backfill-thumbs | tee /dev/stderr | grep -q '"remaining":0'; do sleep 1; done
export async function handleBackfillThumbs(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  const { results: rows } = await env.DB
    .prepare("SELECT id, r2_key FROM covers WHERE thumb_url IS NULL LIMIT 25")
    .all();

  let done = 0;
  for (const row of rows) {
    const obj = await env.COVERS_BUCKET.get(row.r2_key);
    if (!obj) continue;
    const thumbKey = `thumb/${row.r2_key}`;
    await generateThumbnail(env, obj.body, thumbKey);
    await env.DB
      .prepare("UPDATE covers SET thumb_url = ? WHERE id = ?")
      .bind(`${env.R2_PUBLIC_URL}/${thumbKey}`, row.id)
      .run();
    done++;
  }

  const { results: [{ remaining }] } = await env.DB
    .prepare("SELECT COUNT(*) AS remaining FROM covers WHERE thumb_url IS NULL")
    .all();

  return json({ ok: true, done, remaining });
}
