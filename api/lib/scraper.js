export const NEWSPAPERS = [
  { slug: "record", capasjornais: "jornal_record",  capasjornaisPage: "Capa-Jornal-Record",  sapoUrl: "https://sapo.pt/noticias/jornais/desporto/record-4139/{date}" },
  { slug: "abola",  capasjornais: "jornal_a_bola",  capasjornaisPage: "Capa-Jornal-A-Bola",  sapoUrl: "https://sapo.pt/noticias/jornais/desporto/a-bola-4137/{date}" },
  { slug: "ojogo",  capasjornais: "jornal_o_jogo",  capasjornaisPage: "Capa-Jornal-O-Jogo",  sapoUrl: "https://sapo.pt/noticias/jornais/desporto/o-jogo-4138/{date}" },
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

// capasjornais.pt is the primary source: its images carry no watermark (sapo.pt's
// do), and the URL is computable from the date alone — no page to fetch, no
// HTMLRewriter. sapo.pt is the fallback, used when capasjornais.pt 404s or is
// down, which does happen — it went dark for hours on 2026-08-24.
export function capasjornaisUrl(newspaper, dateStr) {
  const [y, m, d] = [dateStr.slice(0, 4), dateStr.slice(4, 6), dateStr.slice(6, 8)];
  return `https://capasjornais.pt/img/FrontPages/${y}${m}/${newspaper.capasjornais}_${d}${m}${y}.jpg`;
}

// Pulls the "Títulos da Capa" block out of a capasjornais.pt page: one
// <li><span> under <h2 class="BottomNews">, already "•"-joined into a
// single string. Plain string parsing rather than HTMLRewriter (used for
// the cover image above) so this stays testable with plain node, no
// Workers runtime needed — see scraper.test.mjs.
export function extractHeadlinesFromHtml(html) {
  const marker = html.indexOf("BottomNews");
  if (marker === -1) return null;

  const match = html.slice(marker).match(/<li[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/li>/);
  if (!match) return null;

  const text = match[1].replace(/\s+/g, " ").trim();
  return text || null;
}

// null rather than a throw: a dead source is the normal case here, not an error.
async function tryFetch(url) {
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS });
    return res.ok ? res : null;
  } catch (err) {
    console.error(`Fetch failed for ${url}: ${err}`);
    return null;
  }
}

// capasjornais.pt's per-newspaper page always shows *today's* edition, no
// date parameter. Fetching it for anything but today's scrape would
// mislabel today's headlines onto a past cover, so this is only ever
// called when the target date is actually today — scrapeNewspaper checks
// that below, handlers/backfill-headlines.js checks it before calling this
// directly for covers scraped earlier the same day. Same non-fatal spirit
// as fetchCover: any failure (403, timeout, markup drift) returns null and
// never blocks the cover image save.
export async function fetchHeadlines(newspaper) {
  const res = await tryFetch(`https://capasjornais.pt/${newspaper.capasjornaisPage}.html`);
  if (!res) return null;
  return extractHeadlinesFromHtml(await res.text());
}

// The cover image itself, from whichever source still has it.
async function fetchCover(newspaper, dateStr) {
  const primary = await tryFetch(capasjornaisUrl(newspaper, dateStr));
  if (primary) return primary;

  const page = await tryFetch(newspaper.sapoUrl.replace("{date}", dateStr));
  if (!page) return null;
  const imgUrl = await extractCoverImage(page);
  return imgUrl && tryFetch(imgUrl);
}

export async function scrapeNewspaper(newspaper, date, env) {
  const dateStr   = date.toISOString().slice(0, 10).replace(/-/g, "");  // 20260425
  const dateLabel = date.toISOString().slice(0, 10);                    // 2026-04-25
  const year      = dateLabel.slice(0, 4);
  const month     = dateLabel.slice(5, 7);
  const day       = dateLabel.slice(8, 10);

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

  const imgResponse = await fetchCover(newspaper, dateStr);
  if (!imgResponse) {
    console.error(`No cover for ${newspaper.slug} ${dateLabel}: capasjornais.pt and sapo.pt both came up empty`);
    return;
  }

  const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
  const [fullBody, thumbSource] = imgResponse.body.tee();

  const thumbKey = `thumb/${r2Key}`;
  const thumbUrl = `${env.R2_PUBLIC_URL}/${thumbKey}`;

  const isToday = dateLabel === new Date().toISOString().slice(0, 10);
  const [, , headlines] = await Promise.all([
    env.COVERS_BUCKET.put(r2Key, fullBody, { httpMetadata: { contentType } }),
    generateThumbnail(env, thumbSource, thumbKey),
    isToday ? fetchHeadlines(newspaper) : Promise.resolve(null),
  ]);

  await env.DB
    .prepare("INSERT INTO covers (newspaper, date, r2_key, url, thumb_url, headlines) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(newspaper.slug, dateLabel, r2Key, publicUrl, thumbUrl, headlines)
    .run();

  console.log(`Saved ${newspaper.slug} ${dateLabel} → ${r2Key}`);

  // No classification here: ai_club stays NULL until rag-classify.yml picks
  // this cover up (fired by scrape-completed right after this scrape settles
  // — see api/lib/github.js and dashboard/documentation/ai-detector.md).
  // Classification always runs with RAG context now, never bare zero-shot.
}
