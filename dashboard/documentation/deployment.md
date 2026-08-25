# Deployment

## Worker

Deploys automatically via GitHub Actions (`deploy-worker.yml`) on push to `api/**` or `wrangler.toml`.
Manual deploy:

```bash
wrangler deploy
```

Secrets must be set once:

```bash
wrangler secret put ADMIN_SECRET
wrangler secret put R2_PUBLIC_URL
```

## R2 CORS policy

The bucket CORS policy is stored in `cors.json`. Apply it with:

```bash
wrangler r2 bucket cors put capas-storage --file cors.json
```

## Frontend

Deployed automatically by the two git-connected Cloudflare Pages projects (`capas-landing` → `dashboard/`, `capas-app` → `app/`) on every push to this branch — no build step, no GitHub Actions workflow involved. See [Frontend](#frontend) for what each project serves.

> The frontend used to be served by GitHub Pages. DNS has moved off it, but the repo's Pages source setting (Settings → Pages) hasn't been switched to "None" yet — cosmetic cleanup, not urgent.
