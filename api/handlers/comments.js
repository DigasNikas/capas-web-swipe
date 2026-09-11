import { json, requireAdmin } from "../lib/http.js";

// Public OAuth client ID — same Google client the Cloudflare Access IdP uses.
// It is not a secret (it ships in the dashboard's source too); only the
// authorised JavaScript origins registered against it matter.
const GOOGLE_CLIENT_ID = "107331929504-16jvt0ml8gago9iofrd2sqtg1barsob6.apps.googleusercontent.com";

const MAX_LEN     = 240;
const MAX_PER_DAY = 5;
const COOLDOWN_S  = 60;

// Comments hang off the newest cover day, so they stop being reachable the
// moment the scraper lands tomorrow's covers. That read filter *is* the
// expiry; the nightly DELETE in index.js is only housekeeping.
async function latestDate(env) {
  const row = await env.DB.prepare("SELECT MAX(date) AS d FROM analytics_covers").first();
  return row?.d ?? null;
}

export async function handleGetComments(env) {
  const date = await latestDate(env);
  if (!date) return json({ date: null, comments: [] });

  const { results } = await env.DB
    .prepare("SELECT id, author, body, created_at FROM comments WHERE date = ? ORDER BY created_at ASC")
    .bind(date)
    .all();
  return json({ date, comments: results });
}

export async function handlePostComment(request, env) {
  let payload;
  try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const body = String(payload.body ?? "").trim();
  if (!body) return json({ error: "Escreve alguma coisa primeiro." }, 400);
  if (body.length > MAX_LEN) return json({ error: `Máximo ${MAX_LEN} caracteres.` }, 400);

  const identity = await verifyGoogleToken(payload.id_token);
  if (!identity) return json({ error: "Sessão expirada — entra outra vez." }, 401);

  const date = await latestDate(env);
  if (!date) return json({ error: "Ainda não há capas para comentar." }, 409);

  // The limits are the insert's own WHERE clause, so checking and writing are
  // one statement. As a SELECT then an INSERT, parallel posts all read the
  // same pre-insert count and every one of them got through. Comments are
  // day-scoped, so the daily count and the cooldown read off the same rows.
  const comment = await env.DB
    .prepare(`
      INSERT INTO comments (date, author, author_sub, body)
      SELECT ?1, ?2, ?3, ?4
      WHERE (SELECT COUNT(*) FROM comments WHERE author_sub = ?3 AND date = ?1) < ?5
        AND NOT EXISTS (
          SELECT 1 FROM comments
          WHERE author_sub = ?3 AND date = ?1 AND created_at > datetime('now', ?6)
        )
      RETURNING id, author, body, created_at
    `)
    .bind(date, identity.name, identity.sub, body, MAX_PER_DAY, `-${COOLDOWN_S} seconds`)
    .first();
  if (comment) return json(comment, 201);

  // Refused. Only now read the count, and only to say which limit it was.
  const { n } = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM comments WHERE author_sub = ? AND date = ?")
    .bind(identity.sub, date)
    .first();
  if (n >= MAX_PER_DAY) return json({ error: `Máximo ${MAX_PER_DAY} comentários por dia.` }, 429);
  return json({ error: "Calma — espera um minuto." }, 429);
}

// DELETE /comments/:id — the id is a path segment rather than ?id=, which is
// what every other write here does with its parameters (a JSON body); a DELETE
// body is the one shape that isn't portable across HTTP clients.
export async function handleDeleteComment(request, env, id) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  if (!Number.isInteger(id) || id < 1) return json({ error: "Invalid comment id" }, 400);

  await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// ponytail: one tokeninfo round-trip per POST instead of caching Google's
// JWKS and verifying RS256 locally. Swap to WebCrypto if volume ever makes
// the extra hop matter.
async function verifyGoogleToken(token) {
  if (typeof token !== "string" || !token) return null;

  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!res.ok) return null;  // Google rejects expired or forged tokens here

  const t = await res.json();
  if (t.aud !== GOOGLE_CLIENT_ID || !t.sub) return null;

  // First name only — enough to be human, less exposing than the full name.
  const name = (t.given_name || t.name || "").trim().split(/\s+/)[0] || "Anónimo";
  // Same identifier the app's leaderboard uses (email local-part) — first
  // names collide, this doesn't.
  const localPart = String(t.email || "").split("@")[0];
  const author = localPart ? `${name} - ${localPart}` : name;
  return { sub: t.sub, name: author.slice(0, 40) };
}
