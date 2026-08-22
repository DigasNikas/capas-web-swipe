import { generateThumbnail } from "../lib/scraper.js";

// One-off: generates thumb_url for covers scraped before thumbnails existed.
// Trigger manually: curl -X POST -H "Authorization: Bearer <ADMIN_SECRET>" https://capas.digasnikas.com/api/backfill-thumbs
export async function handleBackfillThumbs(request, env, ctx) {
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { results: rows } = await env.DB
    .prepare("SELECT id, r2_key FROM covers WHERE thumb_url IS NULL")
    .all();

  ctx.waitUntil((async () => {
    for (const row of rows) {
      const obj = await env.COVERS_BUCKET.get(row.r2_key);
      if (!obj) continue;
      const thumbKey = `thumb/${row.r2_key}`;
      await generateThumbnail(env, obj.body, thumbKey);
      await env.DB
        .prepare("UPDATE covers SET thumb_url = ? WHERE id = ?")
        .bind(`${env.R2_PUBLIC_URL}/${thumbKey}`, row.id)
        .run();
    }
  })());

  return new Response(`Backfilling ${rows.length} thumbnail(s).`, { status: 202 });
}
