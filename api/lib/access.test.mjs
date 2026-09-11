/**
 * Self-check for Access JWT validation: node api/lib/access.test.mjs
 *
 * Signs tokens with a key generated here and serves it as the team's certs.
 */
import assert from "node:assert";
import { accessEmail } from "./access.js";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag";
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

const ALG = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const real = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", real.publicKey)), kid: "k1", alg: "RS256" };

let certFetches = 0;
globalThis.fetch = async url => {
  assert.equal(String(url), `https://${TEAM}/cdn-cgi/access/certs`);
  certFetches++;
  return { ok: true, json: async () => ({ keys: [jwk] }) };
};

const b64url = data => Buffer.from(data).toString("base64url");
const now = Math.floor(Date.now() / 1000);

async function sign(claims = {}, { key = real.privateKey, header = {} } = {}) {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: "k1", ...header }));
  const p = b64url(JSON.stringify({
    aud: [AUD], iss: `https://${TEAM}`, email: "ana@x.pt", iat: now, nbf: now, exp: now + 600, ...claims,
  }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

const req = headers => new Request("https://app.capas.digasnikas.com/api/swipes", { headers });
const withToken = token => req({ "Cf-Access-Jwt-Assertion": token });

assert.equal(await accessEmail(withToken(await sign()), env), "ana@x.pt", "valid token");
assert.equal(await accessEmail(withToken(await sign()), env), "ana@x.pt");
assert.equal(certFetches, 1, "certs cached across requests");

// The email header alone is what a forger would send.
assert.equal(await accessEmail(req({ "Cf-Access-Authenticated-User-Email": "ana@x.pt" }), env), null, "header without token");
assert.equal(await accessEmail(req({}), env), null, "nothing");
assert.equal(await accessEmail(withToken("a.b.c"), env), null, "garbage");

assert.equal(await accessEmail(withToken(await sign({ aud: ["other-app"] })), env), null, "wrong aud");
assert.equal(await accessEmail(withToken(await sign({ iss: "https://evil.cloudflareaccess.com" })), env), null, "wrong iss");
assert.equal(await accessEmail(withToken(await sign({ exp: now - 1 })), env), null, "expired");
assert.equal(await accessEmail(withToken(await sign({ nbf: now + 600 })), env), null, "not yet valid");
assert.equal(await accessEmail(withToken(await sign({ email: undefined })), env), null, "no email");
assert.equal(await accessEmail(withToken(await sign({}, { key: other.privateKey })), env), null, "forged signature");
assert.equal(await accessEmail(withToken(await sign({}, { header: { alg: "none" } })), env), null, "alg none");

// Unknown kid: refetch (key rotation), but not on every request.
const unknownKid = await sign({}, { header: { kid: "k2" } });
certFetches = 0;
assert.equal(await accessEmail(withToken(unknownKid), env), null, "unknown kid");
assert.equal(certFetches, 0, "no refetch within a minute of the last one");
const realNow = Date.now;
Date.now = () => realNow() + 120_000;
assert.equal(await accessEmail(withToken(unknownKid), env), null);
assert.equal(await accessEmail(withToken(unknownKid), env), null);
assert.equal(certFetches, 1, "one refetch after that");
Date.now = realNow;

// Unconfigured means nobody gets in, not everybody.
assert.equal(await accessEmail(withToken(await sign()), {}), null, "no config");

// wrangler dev has no Access in front of it; e2e/run.cjs sets this var there.
assert.equal(
  await accessEmail(req({ "Cf-Access-Authenticated-User-Email": "e2e@test.local" }), { TRUST_ACCESS_EMAIL_HEADER: "1" }),
  "e2e@test.local",
);

console.log("access: ok");
