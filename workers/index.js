/**
 * Cloudflare Worker — daily newspaper cover scraper
 *
 * Bindings required (set in wrangler.toml):
 *   COVERS_BUCKET  — R2 bucket
 *   DB             — D1 database
 *
 * Env vars required (set via: wrangler secret put <NAME>):
 *   ADMIN_SECRET   — bearer token for the /scrape and /notify endpoints
 *   R2_PUBLIC_URL  — public base URL for the R2 bucket (no trailing slash)
 *   RESEND_API_KEY — Resend API key for sending notification emails
 */

import { CORS } from "./lib/http.js";
import { NEWSPAPERS, scrapeNewspaper } from "./lib/scraper.js";
import { handleCovers } from "./handlers/covers.js";
import { handleGetMatches } from "./handlers/matches.js";
import { handleGetSwipes, handleSwipe } from "./handlers/swipes.js";
import { handleLeaderboard } from "./handlers/leaderboard.js";
import { handleScrape } from "./handlers/scrape.js";
import { handleNotify } from "./handlers/notify.js";

export default {
  async scheduled(event, env, ctx) {
    const today = new Date();
    for (const newspaper of NEWSPAPERS) {
      ctx.waitUntil(scrapeNewspaper(newspaper, today, env));
    }
  },

  async fetch(request, env, ctx) {
    const { method, url: rawUrl } = request;
    const url = new URL(rawUrl);
    const pathname = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";

    if (method === "OPTIONS") return new Response(null, { headers: CORS });

    if (method === "GET"  && pathname === "/covers")      return handleCovers(request, env);
    if (method === "GET"  && pathname === "/matches")     return handleGetMatches(env);
    if (method === "GET"  && pathname === "/leaderboard") return handleLeaderboard(request, env);
    if (method === "GET"  && pathname === "/swipes")      return handleGetSwipes(request, env);
    if (method === "POST" && pathname === "/swipes")      return handleSwipe(request, env);
    if (method === "GET"  && pathname === "/scrape")      return handleScrape(request, env, ctx, url);
    if (method === "POST" && pathname === "/notify")      return handleNotify(request, env);

    return new Response("Not found", { status: 404 });
  },
};
