#!/usr/bin/env node
/**
 * One-off: fills `headlines` for every cover already in the archive from
 * before that column existed. scrapeNewspaper's own headline fetch only
 * works for the day it runs on — capasjornais.pt's per-newspaper page has
 * no date parameter, always "today's edition" — so covers from any earlier
 * date have no headline source there. This script uses a different page on
 * the same site instead: each newspaper's monthly archive
 * (Arquivo-Jornal-X-Mes-{month}-{year}.html) lists that whole month's
 * covers with dated permalinks (Capa-Jornal-X-dia-DD-Mês-YYYY-<id>.html),
 * and those dated pages carry the exact same "Títulos da Capa" block the
 * live scraper already knows how to read — see extractHeadlinesFromHtml
 * in api/lib/scraper.js, reused here unchanged.
 *
 * Local-only for now, not a GitHub Action: capasjornais.pt's tolerance for
 * runner IPs at this volume (~1800 requests) is untested, and this only
 * needs to run once per historical gap, not on a schedule.
 *
 *   ADMIN_SECRET=… node scripts/backfill_headlines_archive.mjs
 *   ADMIN_SECRET=… node scripts/backfill_headlines_archive.mjs --limit 50   # smoke test
 *   ADMIN_SECRET=… node scripts/backfill_headlines_archive.mjs --delay 500 # more polite
 *
 * Needs ADMIN_SECRET (the Worker's own bearer token) for /headline-candidates
 * and /update-headline. No Cloudflare API token needed — everything else is
 * a plain fetch against capasjornais.pt.
 */
import { NEWSPAPERS, extractHeadlinesFromHtml } from "../api/lib/scraper.js";

const API_BASE = process.env.CAPAS_API ?? "https://capas.digasnikas.com/api";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const LIMIT = Number(flag("limit", "2000"));
const DELAY_MS = Number(flag("delay", "300"));

// Same spoofed headers scraper.js uses — capasjornais.pt 403s a bare fetch.
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
  "Referer": "https://capasjornais.pt/",
};

const MONTH_PT = {
  janeiro: 1, fevereiro: 2, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
const MONTH_NAME_BY_NUM = Object.fromEntries(Object.entries(MONTH_PT).map(([name, n]) => [n, name]));

export function archiveMonthUrl(newspaper, year, month) {
  const page = newspaper.capasjornaisPage.replace(/^Capa-/, "");
  return `https://capasjornais.pt/capas/Arquivo-${page}-Mes-${MONTH_NAME_BY_NUM[month]}-${year}.html`;
}

// A month archive page lists every day twice (thumbnail link + text link
// under it, same id both times) — a Map naturally collapses that to one
// entry per date.
export function parseArchivePage(html) {
  const re = /href="(\/Capa-Jornal-[^"]+-dia-(\d{2})-([A-Za-zÀ-ÿ]+)-(\d{4})-\d+\.html)"/g;
  const map = new Map();
  let m;
  while ((m = re.exec(html))) {
    const [, path, day, monthName, year] = m;
    const month = MONTH_PT[monthName.toLowerCase()];
    if (!month) continue;
    map.set(`${year}-${String(month).padStart(2, "0")}-${day}`, `https://capasjornais.pt${path}`);
  }
  return map;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS });
    return res.ok ? await res.text() : null;
  } catch (err) {
    console.error(`Fetch failed for ${url}: ${err}`);
    return null;
  }
}

async function main() {
  const res = await fetch(`${API_BASE}/headline-candidates?limit=${LIMIT}`, {
    headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
  });
  if (!res.ok) {
    console.error(`/headline-candidates failed: ${res.status}`);
    process.exit(1);
  }
  const candidates = await res.json();
  console.log(`${candidates.length} covers missing headlines`);

  // Keyed on "slug-year-month" -> Map(date -> permalink) | null (archive
  // fetch failed). One archive fetch per (newspaper, month) covers every
  // candidate in it, instead of one fetch per cover.
  const archiveCache = new Map();

  let done = 0, skipped = 0;
  for (const [i, cover] of candidates.entries()) {
    const newspaper = NEWSPAPERS.find(n => n.slug === cover.newspaper);
    if (!newspaper) { skipped++; continue; }

    const [year, month] = cover.date.split("-");
    const cacheKey = `${newspaper.slug}-${year}-${month}`;
    if (!archiveCache.has(cacheKey)) {
      const html = await fetchText(archiveMonthUrl(newspaper, Number(year), Number(month)));
      archiveCache.set(cacheKey, html ? parseArchivePage(html) : null);
      await sleep(DELAY_MS);
    }

    const permalink = archiveCache.get(cacheKey)?.get(cover.date);
    if (!permalink) {
      console.log(`  [${i + 1}/${candidates.length}] ${cover.date} ${cover.newspaper}: not in archive, skip`);
      skipped++;
      continue;
    }

    const html = await fetchText(permalink);
    const headlines = html && extractHeadlinesFromHtml(html);
    await sleep(DELAY_MS);
    if (!headlines) {
      console.log(`  [${i + 1}/${candidates.length}] ${cover.date} ${cover.newspaper}: no headline block, skip`);
      skipped++;
      continue;
    }

    const put = await fetch(`${API_BASE}/update-headline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: cover.id, headlines }),
    });
    if (!put.ok) {
      console.log(`  [${i + 1}/${candidates.length}] ${cover.date} ${cover.newspaper}: update-headline failed ${put.status}`);
      skipped++;
      continue;
    }

    done++;
    if (done % 25 === 0) console.log(`  ${done}/${candidates.length} done...`);
  }

  console.log(`Done: ${done} updated, ${skipped} skipped, ${candidates.length} total.`);
}

// Guarded so scripts/backfill_headlines_archive.test.mjs can import
// parseArchivePage/archiveMonthUrl without running the real crawl.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!ADMIN_SECRET) {
    console.error("Set ADMIN_SECRET (the Worker's admin bearer token, not a Cloudflare token).");
    process.exit(1);
  }
  main();
}
