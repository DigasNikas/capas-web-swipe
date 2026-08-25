# app/

This README is a map, not the manual — the reasoning lives at [capas.digasnikas.com/documentation](https://capas.digasnikas.com/documentation).

Cloudflare Pages project `capas-app`, deployed at `app.capas.digasnikas.com`, behind Cloudflare Access. One page — the swipe app, with account/leaderboard/instructions/settings all as modals rather than separate routes. Native ES modules, no build step.

| File | What |
|---|---|
| `index.html` | Swipe app |
| `app.js` | Swipe app entry (ES module): event listeners + `init()` |
| `style.css` | All app styles — one page, one stylesheet |
| `src/state.js` | Shared mutable state + all constants (`ACTIONS`, `API_URL`, …) |
| `src/dom.js` | DOM element references (app page) |
| `src/dates.js` | Date/time formatting and grouping helpers |
| `src/calendar.js` | Calendar rendering, month navigation, date-click handler |
| `src/ui.js` | Progress bar, date header, empty state updates |
| `src/cards.js` | Card stack, swipe gestures, commit logic, group navigation |
| `src/catalogue.js` | Histórico rendering (drill-down, filters, image grid) |
| `src/leaderboard.js` | Leaderboard modal (fetch + render) — rows drill down into a per-user club breakdown + streaks (`GET /api/user-stats`) |
| `src/account.js` | Conta modal (stats, rank, Histórico) — reuses `catalogue.js` |
| `src/settings.js` | Definições modal (vote method toggles, theme) — persists to `localStorage` |
| `src/modals.js` | `animateModalClose`, swipe-down-to-close, instrucoes modal |

`src/` and `style.css` live here rather than being shared with `dashboard/` because only `app.js` uses them. Modules share state via the `state` object exported from `src/state.js`, passed by reference across every import.
