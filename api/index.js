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

import { CORS, edgeCached, json } from "./lib/http.js";
import { scrapeDay } from "./lib/scraper.js";
import { dispatchGithubEvent } from "./lib/github.js";
import { handleCovers } from "./handlers/covers.js";
import { handleGetMatches } from "./handlers/matches.js";
import { handleGetSwipes, handleSwipe, handleToggleFavorite } from "./handlers/swipes.js";
import { handleLeaderboard } from "./handlers/leaderboard.js";
import { handleUserStats } from "./handlers/user-stats.js";
import { handleScrape } from "./handlers/scrape.js";
import { handleNotify } from "./handlers/notify.js";
import { handleDetector } from "./handlers/detector.js";
import { handleStats } from "./handlers/stats.js";
import { handleBackfillThumbs } from "./handlers/backfill-thumbs.js";
import { handleRagCandidates } from "./handlers/rag-candidates.js";
import { handleReclassifyRag } from "./handlers/reclassify-rag.js";
import { handleRagMatches } from "./handlers/rag-matches.js";
import { handleLabelConsensus } from "./handlers/label-consensus.js";
import { handleSimilarities } from "./handlers/similarities.js";
import { handleVectorizeCandidates } from "./handlers/vectorize-candidates.js";
import { handleVectorizeMark } from "./handlers/vectorize-mark.js";
import { handleHeadlineCandidates } from "./handlers/headline-candidates.js";
import { handleUpdateHeadline } from "./handlers/update-headline.js";
import { handleSearch } from "./handlers/search.js";
import { handleHeadlines } from "./handlers/headlines.js";
import { handleGetComments, handlePostComment, handleDeleteComment } from "./handlers/comments.js";

// The last cron of the day. After this hour the day's covers get classified
// whether or not their titles ever showed up.
const LAST_SCRAPE_HOUR = 13;

export default {
  // Every cron does the same thing: scrape today, then dispatch
  // classification once the day is settled. scrapeNewspaper is idempotent
  // (see scraper.js), so running it six times a day costs three D1 reads on
  // a finished day and fills whatever is still missing on an unfinished one.
  //
  // The dispatch waits for the titles because a cover classified without them
  // is read without them: no titles block in the prompt, no headline
  // retrieval, no `others` gate score. LAST_SCRAPE_HOUR is the backstop, for
  // the days capasjornais.pt never publishes titles at all — the cover still
  // has to get classified.
  async scheduled(event, env, ctx) {
    const hour = new Date(event.scheduledTime).getUTCHours();
    ctx.waitUntil(
      scrapeDay(env, new Date()).then(settled => {
        if (settled || hour >= LAST_SCRAPE_HOUR) return dispatchGithubEvent(env, "scrape-completed");
        console.log(`Titles still missing at ${hour}:00 UTC, leaving classification to a later run`);
      }),
    );
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
    if (method === "GET"  && pathname === "/stats")       return edgeCached(request, ctx, 60, () => handleStats(env));
    // Not edgeCached: the response depends on ?threshold= and on a secret that
    // can change between requests, and the payload is a fraction of /stats.
    if (method === "GET"  && pathname === "/detector")    return handleDetector(request, env);
    if (method === "GET"  && pathname === "/leaderboard") return handleLeaderboard(request, env);
    if (method === "GET"  && pathname === "/user-stats")  return handleUserStats(request, env, url);
    if (method === "GET"  && pathname === "/swipes")      return handleGetSwipes(request, env);
    if (method === "POST" && pathname === "/swipes")      return handleSwipe(request, env, ctx);
    if (method === "POST" && pathname === "/favorites")   return handleToggleFavorite(request, env);
    if (method === "POST" && pathname === "/scrape")      return handleScrape(request, env, ctx, url);
    if (method === "POST" && pathname === "/notify")      return handleNotify(request, env);
    if (method === "POST" && pathname === "/backfill-thumbs") return handleBackfillThumbs(request, env);
    if (method === "GET"  && pathname === "/rag-candidates")  return handleRagCandidates(request, env);
    if (method === "POST" && pathname === "/reclassify-rag")  return handleReclassifyRag(request, env);
    if (method === "POST" && pathname === "/rag-matches")      return handleRagMatches(request, env);
    if (method === "POST" && pathname === "/label-consensus")  return handleLabelConsensus(request, env);
    if (method === "GET"  && pathname === "/similarities")    return edgeCached(request, ctx, 60, () => handleSimilarities(env, url));
    if (method === "GET"  && pathname === "/vectorize-candidates") return handleVectorizeCandidates(request, env);
    if (method === "POST" && pathname === "/vectorize-mark")       return handleVectorizeMark(request, env);
    if (method === "GET"  && pathname === "/headline-candidates")  return handleHeadlineCandidates(request, env);
    if (method === "POST" && pathname === "/update-headline")      return handleUpdateHeadline(request, env);
    if (method === "GET"  && pathname === "/search")               return handleSearch(request, env, url);
    if (method === "GET"  && pathname === "/headlines")            return edgeCached(request, ctx, 60, () => handleHeadlines(env));
    if (method === "GET"    && pathname === "/comments") return handleGetComments(env);
    if (method === "POST"   && pathname === "/comments") return handlePostComment(request, env);
    if (method === "DELETE" && pathname.startsWith("/comments/")) {
      return handleDeleteComment(request, env, Number(pathname.slice("/comments/".length)));
    }

    // json(), not a bare Response: a 404 is the one reply that used to go out
    // as plain text without the CORS headers every other reply carries.
    return json({ error: "Not found" }, 404);
  },
};
