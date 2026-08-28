/**
 * Cloudflare Worker — daily newspaper cover scraper
 *
 * Bindings required (set in wrangler.toml):
 *   COVERS_BUCKET  — R2 bucket
 *   DB             — D1 database
 *   IMAGES         — Cloudflare Images (thumbnail generation)
 *   AI             — Workers AI (RAG-augmented cover classification, called from /reclassify-rag only — see lib/ai.js)
 *
 * Env vars required (set via: wrangler secret put <NAME>):
 *   ADMIN_SECRET   — bearer token for the /scrape, /backfill-thumbs, /rag-candidates,
 *                     /reclassify-rag, /vectorize-candidates, /vectorize-mark and /notify endpoints
 *   R2_PUBLIC_URL  — public base URL for the R2 bucket (no trailing slash)
 *   RESEND_API_KEY — Resend API key for sending notification emails
 *
 * Optional env vars:
 *   GH_DISPATCH_TOKEN — GitHub PAT (repo scope) used to fire repository_dispatch
 *                        events (scrape-completed, cover-first-vote) that trigger
 *                        rag-classify.yml / vectorize-covers.yml. Unset, those
 *                        dispatches are silently skipped — see lib/github.js.
 */

import { CORS } from "./lib/http.js";
import { NEWSPAPERS, scrapeNewspaper } from "./lib/scraper.js";
import { dispatchGithubEvent } from "./lib/github.js";
import { handleCovers } from "./handlers/covers.js";
import { handleGetMatches } from "./handlers/matches.js";
import { handleGetSwipes, handleSwipe, handleToggleFavorite } from "./handlers/swipes.js";
import { handleLeaderboard } from "./handlers/leaderboard.js";
import { handleUserStats } from "./handlers/user-stats.js";
import { handleScrape } from "./handlers/scrape.js";
import { handleNotify } from "./handlers/notify.js";
import { handleStats } from "./handlers/stats.js";
import { handleBackfillThumbs } from "./handlers/backfill-thumbs.js";
import { handleRagCandidates } from "./handlers/rag-candidates.js";
import { handleReclassifyRag } from "./handlers/reclassify-rag.js";
import { handleSimilarities } from "./handlers/similarities.js";
import { handleVectorizeCandidates } from "./handlers/vectorize-candidates.js";
import { handleVectorizeMark } from "./handlers/vectorize-mark.js";
import { handleGetComments, handlePostComment, handleDeleteComment } from "./handlers/comments.js";

export default {
  async scheduled(event, env, ctx) {
    const today = new Date();
    // Independent catches, same as the old per-newspaper waitUntil: one
    // newspaper's failure must not stop the others, or the dispatch below.
    const scrapes = NEWSPAPERS.map(newspaper =>
      scrapeNewspaper(newspaper, today, env)
        .catch(err => console.error(`Scrape failed for ${newspaper.slug}: ${err}`))
    );
    ctx.waitUntil(Promise.all(scrapes).then(() => dispatchGithubEvent(env, "scrape-completed")));
    // Comments are already unreachable once a newer day exists — this just
    // stops the table growing.
    ctx.waitUntil(env.DB.prepare("DELETE FROM comments WHERE date < date('now','-2 days')").run());
  },

  async fetch(request, env, ctx) {
    const { method, url: rawUrl } = request;
    const url = new URL(rawUrl);
    const pathname = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";

    if (method === "OPTIONS") return new Response(null, { headers: CORS });

    if (method === "GET"  && pathname === "/covers")      return handleCovers(request, env);
    if (method === "GET"  && pathname === "/matches")     return handleGetMatches(env);
    if (method === "GET"  && pathname === "/stats")       return handleStats(env);
    if (method === "GET"  && pathname === "/leaderboard") return handleLeaderboard(request, env);
    if (method === "GET"  && pathname === "/user-stats")  return handleUserStats(request, env, url);
    if (method === "GET"  && pathname === "/swipes")      return handleGetSwipes(request, env);
    if (method === "POST" && pathname === "/swipes")      return handleSwipe(request, env, ctx);
    if (method === "POST" && pathname === "/favorites")   return handleToggleFavorite(request, env);
    if (method === "GET"  && pathname === "/scrape")      return handleScrape(request, env, ctx, url);
    if (method === "POST" && pathname === "/notify")      return handleNotify(request, env);
    if (method === "POST" && pathname === "/backfill-thumbs") return handleBackfillThumbs(request, env);
    if (method === "GET"  && pathname === "/rag-candidates")  return handleRagCandidates(request, env);
    if (method === "POST" && pathname === "/reclassify-rag")  return handleReclassifyRag(request, env);
    if (method === "GET"  && pathname === "/similarities")    return handleSimilarities(env);
    if (method === "GET"  && pathname === "/vectorize-candidates") return handleVectorizeCandidates(request, env);
    if (method === "POST" && pathname === "/vectorize-mark")       return handleVectorizeMark(request, env);
    if (method === "GET"    && pathname === "/comments") return handleGetComments(env);
    if (method === "POST"   && pathname === "/comments") return handlePostComment(request, env);
    if (method === "DELETE" && pathname === "/comments") return handleDeleteComment(request, env, url);

    return new Response("Not found", { status: 404 });
  },
};
