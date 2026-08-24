import { classifyAndStore } from "./ai.js";

export const NEWSPAPERS = [
  { slug: "record", url: "https://sapo.pt/noticias/jornais/desporto/record-4139/{date}" },
  { slug: "abola",  url: "https://sapo.pt/noticias/jornais/desporto/a-bola-4137/{date}" },
  { slug: "ojogo",  url: "https://sapo.pt/noticias/jornais/desporto/o-jogo-4138/{date}" },
];

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
  "Referer": "https://sapo.pt/",
};

// Covers are only ever shown this small as thumbnails (calendar day panel,
// "última classificação"); full res is still one click away via the modal.
// 220px covers 2-3x retina at the ~58-90px CSS sizes they're actually shown at.
export async function generateThumbnail(env, sourceStream, thumbKey) {
  const thumb = (
    await env.IMAGES.input(sourceStream)
      .transform({ width: 220 })
      .output({ format: "image/webp", quality: 45 })
  ).response();
  await env.COVERS_BUCKET.put(thumbKey, thumb.body, {
    httpMetadata: { contentType: "image/webp" },
  });
}

async function extractCoverImage(response) {
  let imageUrl = null;

  const rewriter = new HTMLRewriter().on(".article-newspaper img", {
    element(el) {
      if (!imageUrl) {
        imageUrl = el.getAttribute("src") || el.getAttribute("data-src");
      }
    },
  });

  await rewriter.transform(response).text();
  return imageUrl;
}

export async function scrapeNewspaper(newspaper, date, env) {
  const dateStr   = date.toISOString().slice(0, 10).replace(/-/g, "");  // 20260425
  const dateLabel = date.toISOString().slice(0, 10);                    // 2026-04-25
  const year      = dateLabel.slice(0, 4);
  const month     = dateLabel.slice(5, 7);
  const day       = dateLabel.slice(8, 10);

  const pageUrl   = newspaper.url.replace("{date}", dateStr);
  const r2Key     = `${year}/${month}/${day}/${newspaper.slug}_${dateLabel}.jpg`;
  const publicUrl = `${env.R2_PUBLIC_URL}/${r2Key}`;

  const existing = await env.DB
    .prepare("SELECT id FROM covers WHERE newspaper = ? AND date = ?")
    .bind(newspaper.slug, dateLabel)
    .first();

  if (existing) {
    console.log(`${newspaper.slug} ${dateLabel} already stored, skipping.`);
    return;
  }

  const pageResponse = await fetch(pageUrl, { headers: FETCH_HEADERS });
  if (!pageResponse.ok) {
    console.error(`Failed to fetch page for ${newspaper.slug} ${dateLabel}: ${pageResponse.status}`);
    return;
  }

  const imgUrl = await extractCoverImage(pageResponse);
  if (!imgUrl) {
    console.error(`No cover image found for ${newspaper.slug} ${dateLabel}`);
    return;
  }

  const imgResponse = await fetch(imgUrl, { headers: FETCH_HEADERS });
  if (!imgResponse.ok) {
    console.error(`Failed to download image for ${newspaper.slug} ${dateLabel}: ${imgResponse.status}`);
    return;
  }

  const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
  const [fullBody, thumbSource] = imgResponse.body.tee();

  const thumbKey = `thumb/${r2Key}`;
  const thumbUrl = `${env.R2_PUBLIC_URL}/${thumbKey}`;

  await Promise.all([
    env.COVERS_BUCKET.put(r2Key, fullBody, { httpMetadata: { contentType } }),
    generateThumbnail(env, thumbSource, thumbKey),
  ]);

  const { meta } = await env.DB
    .prepare("INSERT INTO covers (newspaper, date, r2_key, url, thumb_url) VALUES (?, ?, ?, ?, ?)")
    .bind(newspaper.slug, dateLabel, r2Key, publicUrl, thumbUrl)
    .run();

  console.log(`Saved ${newspaper.slug} ${dateLabel} → ${r2Key}`);

  // After the insert, not before: the cover is worth keeping whether or not
  // the model has an opinion about it. classifyAndStore swallows its own
  // errors for the same reason.
  const aiClub = await classifyAndStore(env, meta.last_row_id, r2Key);
  console.log(`AI says ${newspaper.slug} ${dateLabel} is ${aiClub ?? "unclassified"}`);
}
