# Avaliador de Capas Desportivas ⚽

A crowd-sourced tool for cataloguing Portuguese sports newspaper front pages. Users swipe covers left/right/up/down to classify which football club dominates each edition — Benfica (←), Sporting (→), Porto (↓), or Other (↑).

Live at **[capas.digasnikas.com](https://capas.digasnikas.com)**
(the logged-in app lives on its own subdomain: **[app.capas.digasnikas.com](https://app.capas.digasnikas.com)**)

**This README is a map, not the manual.** How everything works — the scraper's fallback source, the AI classifier's prompt history, the alignment math behind "A capa média", the full D1 schema and API — lives at **[capas.digasnikas.com/documentation](https://capas.digasnikas.com/documentation)**.

---

## Where things live

| Folder | What | |
|---|---|---|
| `dashboard/` | Public results page (Pages, `capas.digasnikas.com`) — also serves `/documentation` | [dashboard/README.md](dashboard/README.md) |
| `app/` | Swipe app, behind Cloudflare Access (Pages, `app.capas.digasnikas.com`) | [app/README.md](app/README.md) |
| `api/` | Cloudflare Worker: scraper + REST API, one D1 database behind both frontends | [api/README.md](api/README.md) |
| `scripts/` | Local tooling — each script has a matching one-click GitHub Action | [scripts/README.md](scripts/README.md) |

`wrangler.toml` is the Worker's config (routes, cron, R2/D1/Images/AI bindings); `package.json` only exists to pin the `wrangler` dev dependency — there's no build step anywhere in this repo, frontend included.

> **Note:** the frontends use native ES modules and can't be opened via `file://` — use `wrangler dev` or any local HTTP server for local testing.
