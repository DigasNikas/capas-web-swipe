// Pushes a GitHub Actions repository_dispatch event so a workflow can react
// to something that happened inside the Worker. Two uses today: "a scrape
// just finished" (kicks off rag-classify.yml) and "a cover got its first
// crowd vote" (kicks off vectorize-one-cover.yml). Both are best-effort — a
// failed dispatch never fails the request/cron that triggered it, it just
// means that cover waits for the next scheduled run (rag-classify.yml's own
// self-converging candidate list, build-vectorize.yml's weekly full
// re-embed) to catch up instead.
//
// Needs a GitHub PAT (classic, `repo` scope — fine-grained needs
// "Contents: read and write" or "Actions: write" on this repo) stored as
// GH_DISPATCH_TOKEN: wrangler secret put GH_DISPATCH_TOKEN. Unset, dispatch
// is silently skipped rather than failing the caller.
const REPO = "DigasNikas/capas-web-swipe";

export async function dispatchGithubEvent(env, eventType, clientPayload = {}) {
  if (!env.GH_DISPATCH_TOKEN) return;

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "capas-scraper-worker",
      },
      body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
    });
    if (!res.ok) {
      console.error(`GitHub dispatch "${eventType}" failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`GitHub dispatch "${eventType}" error: ${err}`);
  }
}
