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

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// Pulls the "Títulos da Capa" block out of a capasjornais.pt page: one
// <li><span> under <h2 class="BottomNews">, already "•"-joined into a
// single string, plus the edition it belongs to — the heading reads
// "Títulos da Capa Jornal Record de domingo, 13 de setembro 2026". Plain
// string parsing rather than HTMLRewriter (used for the cover image above)
// so this stays testable with plain node, no Workers runtime needed — see
// scraper.test.mjs.
export function extractHeadlinesFromHtml(html) {
  const marker = html.indexOf("BottomNews");
  if (marker === -1) return null;

  const block = html.slice(marker);
  const match = block.match(/<li[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/li>/);
  if (!match) return null;

  const text = match[1].replace(/\s+/g, " ").trim();
  if (!text) return null;

  const when = block.slice(0, block.indexOf("</h2>")).match(/(\d{1,2}) de (\p{L}+)\s+(\d{4})/u);
  const month = when && MONTHS_PT.indexOf(when[2].toLowerCase());
  const date = when && month >= 0
    ? `${when[3]}-${String(month + 1).padStart(2, "0")}-${when[1].padStart(2, "0")}`
    : null;

  return { date, text };
}

// The headlines to store for a cover, or null when the page is showing a
// different edition. The page takes no date parameter — it serves whatever
// is current — and at 05:00 UTC, when the scrape cron runs, that is still
// yesterday's paper. Storing it anyway is how every cover in the archive came
// to hold the previous day's headlines, and how the classifier came to read
// a match preview on a page reporting the result.
export function headlinesIfFresh(html, dateLabel) {
  const found = extractHeadlinesFromHtml(html);
  return found && found.date === dateLabel ? found.text : null;
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

// capasjornais.pt's per-newspaper page has no date parameter: it shows
// whichever edition it currently has, which early in the morning is still
// yesterday's. The heading says which one, so the caller's date is checked
// against it and a mismatch returns null — see headlinesIfFresh. Only worth
// calling for today's date at all; a past cover has no source here. Same
// non-fatal spirit as fetchCover: any failure (403, timeout, markup drift)
// returns null and never blocks the cover image save.
export async function fetchHeadlines(newspaper, dateLabel) {
  const res = await tryFetch(`https://capasjornais.pt/${newspaper.capasjornaisPage}.html`);
  if (!res) return null;

  const fresh = headlinesIfFresh(await res.text(), dateLabel);
  if (!fresh) console.log(`No ${dateLabel} headlines for ${newspaper.slug} yet — the page is still on another edition`);
  return fresh;
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
    isToday ? fetchHeadlines(newspaper, dateLabel) : Promise.resolve(null),
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
