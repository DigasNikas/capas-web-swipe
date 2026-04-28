/**
 * Cloudflare Worker — daily newspaper cover scraper
 *
 * Bindings required (set in wrangler.toml):
 *   COVERS_BUCKET  — R2 bucket
 *   DB             — D1 database
 *
 * Env vars required (set via: wrangler secret put <NAME>):
 *   ADMIN_SECRET   — bearer token for the /scrape endpoint
 *   R2_PUBLIC_URL  — public base URL for the R2 bucket (no trailing slash)
 *                    e.g. https://pub-xxxx.r2.dev or your custom domain
 */

const NEWSPAPERS = [
  { slug: "record", url: "https://sapo.pt/noticias/jornais/desporto/record-4139/{date}" },
  { slug: "abola",  url: "https://sapo.pt/noticias/jornais/desporto/a-bola-4137/{date}" },
  { slug: "ojogo",  url: "https://sapo.pt/noticias/jornais/desporto/o-jogo-4138/{date}" },
];

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
  "Referer": "https://sapo.pt/",
};

// ── HTML extraction via HTMLRewriter ────────────────────────────────────────
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

// ── Scrape one newspaper for a given date ───────────────────────────────────
async function scrapeNewspaper(newspaper, date, env) {
  const dateStr   = date.toISOString().slice(0, 10).replace(/-/g, "");  // 20260425
  const dateLabel = date.toISOString().slice(0, 10);                    // 2026-04-25
  const year      = dateLabel.slice(0, 4);
  const month     = dateLabel.slice(5, 7);
  const day       = dateLabel.slice(8, 10);

  const pageUrl  = newspaper.url.replace("{date}", dateStr);
  const r2Key    = `${year}/${month}/${day}/${newspaper.slug}_${dateLabel}.jpg`;
  const publicUrl = `${env.R2_PUBLIC_URL}/${r2Key}`;

  // Skip if already in D1
  const existing = await env.DB
    .prepare("SELECT id FROM covers WHERE newspaper = ? AND date = ?")
    .bind(newspaper.slug, dateLabel)
    .first();

  if (existing) {
    console.log(`${newspaper.slug} ${dateLabel} already stored, skipping.`);
    return;
  }

  // Fetch the sapo.pt page
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

  // Download the image
  const imgResponse = await fetch(imgUrl, { headers: FETCH_HEADERS });
  if (!imgResponse.ok) {
    console.error(`Failed to download image for ${newspaper.slug} ${dateLabel}: ${imgResponse.status}`);
    return;
  }

  const contentType = imgResponse.headers.get("content-type") || "image/jpeg";

  // Upload to R2
  await env.COVERS_BUCKET.put(r2Key, imgResponse.body, {
    httpMetadata: { contentType },
  });

  // Insert into D1
  await env.DB
    .prepare("INSERT INTO covers (newspaper, date, r2_key, url) VALUES (?, ?, ?, ?)")
    .bind(newspaper.slug, dateLabel, r2Key, publicUrl)
    .run();

  console.log(`Saved ${newspaper.slug} ${dateLabel} → ${r2Key}`);
}

// ── CORS headers for public endpoints ──────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ── POST /swipes — authenticated via Cloudflare Access ─────────────────────
async function handleSwipe(request, env) {
  const userEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!userEmail) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { cover_id, action } = body;
  if (!cover_id || !action) return json({ error: "Missing cover_id or action" }, 400);

  await env.DB
    .prepare(`
      INSERT INTO swipes (user_email, cover_id, action)
      VALUES (?, ?, ?)
      ON CONFLICT (user_email, cover_id)
      DO UPDATE SET action = excluded.action, swiped_at = datetime('now')
    `)
    .bind(userEmail, cover_id, action)
    .run();

  return json({ ok: true });
}

// ── GET /covers — public ────────────────────────────────────────────────────
async function handleCovers(env) {
  const { results } = await env.DB
    .prepare("SELECT id, newspaper, date, url FROM covers ORDER BY date DESC, newspaper ASC")
    .all();
  return json(results);
}

// ── Entry point ─────────────────────────────────────────────────────────────
export default {
  // Cron trigger — runs daily at 07:00 UTC
  async scheduled(event, env, ctx) {
    const today = new Date();
    for (const newspaper of NEWSPAPERS) {
      ctx.waitUntil(scrapeNewspaper(newspaper, today, env));
    }
  },

  async fetch(request, env, ctx) {
    const { method, url: rawUrl } = request;
    const url = new URL(rawUrl);
    // Strip /api prefix so the Worker handles both
    // capas.digasnikas.com/api/covers and capas-scraper.*.workers.dev/covers
    const pathname = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";

    if (method === "OPTIONS") return new Response(null, { headers: CORS });

    // Public: GET /covers
    if (method === "GET" && pathname === "/covers") {
      return handleCovers(env);
    }

    // Authenticated: POST /swipes
    if (method === "POST" && pathname === "/swipes") {
      return handleSwipe(request, env);
    }

    // Protected: manual scrape trigger — GET /scrape?days=7
    // Requires header: Authorization: Bearer <ADMIN_SECRET>
    if (method === "GET" && pathname === "/scrape") {
      const auth = request.headers.get("Authorization") ?? "";
      if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
        return new Response("Unauthorized", { status: 401 });
      }

      const days = Math.min(parseInt(url.searchParams.get("days") ?? "1"), 30);

    const results = [];
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - i);
      for (const newspaper of NEWSPAPERS) {
        results.push(scrapeNewspaper(newspaper, date, env));
      }
    }

      ctx.waitUntil(Promise.all(results));
      return new Response(`Scraping ${days} day(s) for ${NEWSPAPERS.length} newspapers.`, { status: 202 });
    }

    return new Response("Not found", { status: 404 });
  },
};
