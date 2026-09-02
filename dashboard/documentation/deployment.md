# Deployment

## Worker

Deploys automatically via GitHub Actions (`deploy-worker.yml`) on push to `api/**`, `wrangler.toml` or `migrations/**`.
Manual deploy:

```bash
wrangler deploy
```

Secrets must be set once:

```bash
wrangler secret put ADMIN_SECRET
wrangler secret put R2_PUBLIC_URL
```

## D1 migrations

`deploy-worker.yml` runs `wrangler d1 migrations apply capas-db --remote` before every `wrangler deploy`, not after: new code can start writing to a new column the moment it's live, so the column has to exist first. Wrangler tracks which migrations already ran in a `d1_migrations` table it manages on the database itself, so a deploy with nothing new under `migrations/` just applies zero migrations and moves on.

To add a column or table, drop a new numbered file in `migrations/` (`0003_whatever.sql`, following on from `0001_add_ai_rag_covers.sql` and `0002_add_vectorized_at.sql`) and push it alongside the code that uses it. `schema.sql` stays the reference for what a brand new database should look like. Keep it in sync by hand when a migration changes the shape it describes: `wrangler d1 migrations` only applies migration files, it doesn't read or write `schema.sql`.

A migration can carry a data backfill too, not just a schema change: `0002_add_vectorized_at.sql` adds the column and, in the same file, marks every already-voted cover as already vectorized (an assumption, not a guarantee; see that file's own comment for the gap it accepts). Wrangler just runs the file's SQL as written, in order, so this is nothing special, just more than one statement in the file.

`ai_club`, `ai_headline` and `ai_why` predate this: they were applied to the production database by hand, before `migrations/` existed. Don't write migrations for them. `wrangler d1 migrations apply` would try to add columns the database already has, and fail.

## R2 CORS policy

The bucket CORS policy is stored in `cors.json`. Apply it with:

```bash
wrangler r2 bucket cors put capas-storage --file cors.json
```

## Frontend

Deployed automatically by the two git-connected Cloudflare Pages projects (`capas-dashboard` → `dashboard/`, `capas-app` → `app/`) on every push to this branch. No build step, no GitHub Actions workflow involved. See [Frontend](#frontend) for what each project serves.

> The frontend used to be served by GitHub Pages. DNS has moved off it, but the repo's Pages source setting (Settings → Pages) hasn't been switched to "None" yet. Cosmetic cleanup, low priority.

## End-to-end tests

`e2e/*.e2e.cjs` drives a real Chromium browser against a locally running stack: `wrangler dev` on port 8787 for the worker, plus one `http-server` each for `dashboard/` (8788) and `app/` (8789), each started with `--proxy http://localhost:8787` so an unmatched request (any `/api/*` call) falls through to the worker — the same effective routing `capas.digasnikas.com` gets from the Cloudflare zone's route match, reproduced locally instead of invented as a second thing to maintain.

```bash
npm run test:e2e
```

Bootstraps the local D1 by executing `api/schema.sql` directly, not `wrangler d1 migrations apply`: schema.sql is the authoritative full-state schema (every migration's columns are already in it, see above), and a fresh local database has no migration for the base schema at all — production got it by hand before `migrations/` existed, so `migrations apply` against an empty local D1 fails trying to ALTER-add columns that were never there to begin with.

Playwright isn't a `package.json` dependency — same reasoning as `_headers` below applies to keeping the deploy small: it's only needed to run this suite. `e2e/helpers.cjs` resolves it from `PLAYWRIGHT_PATH`, `node_modules`, or a couple of common local paths; install it once with `npm i --no-save playwright && npx playwright install chromium`.

`app.capas.digasnikas.com` sits behind Cloudflare Access in production, which has no local equivalent under `wrangler dev` — every app-side handler just trusts `Cf-Access-Authenticated-User-Email` on the request (see `api/handlers/covers.js`, `swipes.js`). Locally, suites that need an app session set that header themselves via Playwright's `context.setExtraHTTPHeaders`, reproducing the same trust boundary Access provides in production without faking Access itself.

## Cache-Control (`_headers`)

Both Pages projects carry a `dashboard/_headers` / `app/_headers` file — Cloudflare Pages reads it directly, no build step needed. Same policy in both: `.js`/`.css` get `public, max-age=300, must-revalidate` (5 minutes), `.html` gets `no-cache`.

Five minutes rather than a long-lived cache because none of these filenames carry a content hash (no build step means nothing to hash them) — a stable URL like `/dashboard.js` with a year-long cache would mean a bug fix sitting invisible in an already-open tab for just as long. Five minutes bounds that to roughly a Pages deploy's own propagation time, still cheap enough to save a re-fetch across one visitor's session. `?v=NN` query-string bumps in the HTML (`dashboard.js?v=26`) still matter for forcing a *new* URL after a deploy; `_headers` is what stops the *previous* URL's cache from outliving its usefulness once nothing points at it anymore. Without this file the behavior falls back to whatever Cloudflare Pages' unconfigured default is — which is exactly what produced a real stale-cache confusion mid-session: an edited `dashboard.css` kept rendering in an already-open browser tab with no `_headers` rule telling it to revalidate.
