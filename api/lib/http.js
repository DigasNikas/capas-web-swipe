// Every authenticated call is now same-origin (app.capas.digasnikas.com
// calling its own /api/*), so this is only ever exercised by public,
// credential-less reads (/stats, /matches) — no origin scoping needed.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Shared bearer check for the admin endpoints. Returns null to continue, or
// the response to send back — nine handlers used to carry their own copy of
// this, four of them answering in bare text without CORS while the rest
// answered in JSON.
//
// An unset ADMIN_SECRET is a 501, not a 401: the old copies compared the
// header against `Bearer ${undefined}`, so a misconfigured deployment would
// have authenticated anyone who sent the literal string "Bearer undefined".
// Missing config degrades to a clear failure for that endpoint instead.
export function requireAdmin(request, env) {
  if (!env.ADMIN_SECRET) return json({ error: "ADMIN_SECRET not configured" }, 501);
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_SECRET}`) return json({ error: "Unauthorized" }, 401);
  return null;
}

// ?limit= for the candidate endpoints. Returns the clamped number, or null
// for a value the caller got wrong, which every caller turns into a 400.
//
// The old shape was `Math.min(Number(param) || fallback, max)` in three
// handlers. A negative is truthy, so it skipped the fallback and then won the
// Math.min, and SQLite reads LIMIT -1 as no limit — /rag-candidates?limit=-1
// returned the entire unclassified backlog rather than at most 50, which is
// the unbounded shape rag.md's Quota section exists because of. Rejecting
// instead of silently defaulting also means a typo'd limit says so.
export function parseLimit(url, fallback, max) {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return fallback;

  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, max);
}
