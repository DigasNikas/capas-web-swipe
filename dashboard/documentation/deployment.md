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

To add a column or table, drop a new numbered file in `migrations/` (`0002_whatever.sql`, following on from `0001_add_ai_rag_covers.sql`) and push it alongside the code that uses it. `schema.sql` stays the reference for what a brand new database should look like. Keep it in sync by hand when a migration changes the shape it describes: `wrangler d1 migrations` only applies migration files, it doesn't read or write `schema.sql`.

`ai_club`, `ai_headline` and `ai_why` predate this: they were applied to the production database by hand, before `migrations/` existed. Don't write migrations for them. `wrangler d1 migrations apply` would try to add columns the database already has, and fail.

## R2 CORS policy

The bucket CORS policy is stored in `cors.json`. Apply it with:

```bash
wrangler r2 bucket cors put capas-storage --file cors.json
```

## Frontend

Deployed automatically by the two git-connected Cloudflare Pages projects (`capas-dashboard` → `dashboard/`, `capas-app` → `app/`) on every push to this branch. No build step, no GitHub Actions workflow involved. See [Frontend](#frontend) for what each project serves.

> The frontend used to be served by GitHub Pages. DNS has moved off it, but the repo's Pages source setting (Settings → Pages) has not been switched to "None" yet. Cosmetic cleanup, low priority.
