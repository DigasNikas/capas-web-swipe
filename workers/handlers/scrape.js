import { NEWSPAPERS, scrapeNewspaper } from "../lib/scraper.js";

export async function handleScrape(request, env, ctx, url) {
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let startStr, endStr;
  const daysParam = url.searchParams.get("days");
  if (daysParam) {
    const days = Math.min(Math.max(parseInt(daysParam) || 1, 1), 7);
    const s = new Date();
    s.setUTCDate(s.getUTCDate() - (days - 1));
    startStr = s.toISOString().slice(0, 10).replace(/-/g, "");
    endStr   = todayStr;
  } else {
    startStr = url.searchParams.get("start") ?? todayStr;
    endStr   = url.searchParams.get("end")   ?? todayStr;
  }

  const parseYMD = s => new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00Z`);
  const startDate = parseYMD(startStr);
  const endDate   = parseYMD(endStr);

  if (isNaN(startDate) || isNaN(endDate) || endDate < startDate) {
    return new Response("Invalid date range", { status: 400 });
  }

  const totalDays = Math.round((endDate - startDate) / 86_400_000) + 1;
  if (totalDays > 7) {
    return new Response("Max 7 days per call (subrequest limit)", { status: 400 });
  }

  ctx.waitUntil((async () => {
    for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      await Promise.all(NEWSPAPERS.map(n => scrapeNewspaper(n, new Date(d), env)));
    }
  })());

  return new Response(
    `Scraping ${totalDays} day(s) [${startStr}–${endStr}] for ${NEWSPAPERS.length} newspapers.`,
    { status: 202 }
  );
}
