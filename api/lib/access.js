// Identity for app-side handlers, from the JWT Cloudflare Access signs,
// never the plain Cf-Access-Authenticated-User-Email header: that header is
// only trustworthy while Access sits in front of every route to this Worker.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
//
// ACCESS_TEAM_DOMAIN and ACCESS_AUD are in wrangler.toml [vars].

const KEY_TTL_MS = 60 * 60 * 1000;
const REFETCH_MIN_MS = 60 * 1000;  // bounds cert fetches from tokens with made-up kids

let keys = new Map();
let fetchedAt = 0;

export async function accessEmail(request, env) {
  // wrangler dev has no Access in front; only e2e/run.cjs sets this.
  if (env.TRUST_ACCESS_EMAIL_HEADER === "1") {
    return request.headers.get("Cf-Access-Authenticated-User-Email");
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    console.error("ACCESS_TEAM_DOMAIN / ACCESS_AUD not configured");
    return null;
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  const parts = token?.split(".");
  if (parts?.length !== 3) return null;

  try {
    const [h, p, s] = parts;
    const header = JSON.parse(decode(h));
    const claims = JSON.parse(decode(p));
    if (header.alg !== "RS256") return null;

    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
    const now = Date.now() / 1000;
    const aud = [].concat(claims.aud);
    if (claims.iss !== issuer || !aud.includes(env.ACCESS_AUD)) return null;
    if (!(claims.exp > now) || claims.nbf > now) return null;
    if (typeof claims.email !== "string" || !claims.email) return null;

    const key = await publicKey(issuer, header.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, bytes(s), new TextEncoder().encode(`${h}.${p}`),
    );
    return ok ? claims.email : null;
  } catch {
    return null;
  }
}

async function publicKey(issuer, kid) {
  const age = Date.now() - fetchedAt;
  if (age > KEY_TTL_MS || (!keys.has(kid) && age > REFETCH_MIN_MS)) {
    const res = await fetch(`${issuer}/cdn-cgi/access/certs`);
    if (!res.ok) return null;
    const { keys: jwks } = await res.json();
    const next = new Map();
    for (const jwk of jwks) {
      next.set(jwk.kid, await crypto.subtle.importKey(
        "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
      ));
    }
    keys = next;
    fetchedAt = Date.now();
  }
  return keys.get(kid) ?? null;
}

const bytes = b64url => Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const decode = b64url => new TextDecoder().decode(bytes(b64url));
