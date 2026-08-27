#!/usr/bin/env node
/**
 * Score the prompt in api/lib/ai.js against the crowd labels — without
 * deploying, without touching D1, without re-running the backfill.
 *
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/eval-ai.mjs
 *   ... node scripts/eval-ai.mjs --n 80        # bigger sample
 *   ... node scripts/eval-ai.mjs --all         # every labelled cover, ~579 calls
 *
 * This scores the bare zero-shot PROMPT only. For the RAG-augmented version,
 * see scripts/rag_classify.py --eval — that one needs a local CLIP embedding
 * step this script can't do (Node has no CLIP model), so the RAG measurement
 * lives in Python now, not here.
 *
 * The token needs Workers AI · Read. Everything else is public: the labels come
 * from /api/stats and the covers from R2's public URLs, so no D1 credentials —
 * unless SAMPLE_FILE points at a pre-built sample (see eval-ai.yml), which
 * skips /api/stats entirely.
 *
 * Each call costs neurons against the same 10,000/day free allowance the live
 * scrape uses. The default sample of 40 is a few percent of a day's budget; the
 * full run is not. Run this before and after editing PROMPT — the first prompt
 * shipped at a benchmarked 87% and turned out to be 77% over the real archive,
 * which is what happens when a change is judged by eye.
 *
 * The request body is duplicated from classifyCover rather than shared: that
 * one goes through the Workers AI binding, this one through the REST API, and
 * the point of the script is to run outside the Worker. PROMPT and parseAnswer
 * are imported, which is the part that has to stay identical.
 */
import { readFileSync } from "node:fs";
import { MODEL, PROMPT, CLUBS, parseAnswer, toBase64 } from "../api/lib/ai.js";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const STATS = process.env.CAPAS_STATS ?? "https://capas.digasnikas.com/api/stats";
// capas.digasnikas.com sits behind Cloudflare Bot Fight Mode and can reject
// every GitHub-runner request in a run, not just an occasional one — when
// that's happening, SAMPLE_FILE takes a pre-built `[{club, url}, ...]` JSON
// array (see eval-ai.yml's sample_json input) instead of fetching /api/stats
// and re-deriving the evenly-spaced sample from it.
const SAMPLE_FILE = process.env.SAMPLE_FILE;

if (!ACCOUNT || !TOKEN) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI · Read).");
  process.exit(1);
}

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

// Cloudflare Bot Fight Mode challenges GitHub's runners on both endpoints — a
// per-request coin flip (same one documented in scrape.yml), not something
// a UA header alone reliably beats.
// A retry is the actual fix for a coin flip: without one, one flaky image
// among 80 kills the whole run (classify() below throws on a bad fetch, and
// the caller stops the loop on the first error).
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
async function browserFetch(url, attempts = 3) {
  let res;
  for (let i = 0; i < attempts; i++) {
    res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
    if (res.ok) return res;
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  return res; // still not ok after `attempts` tries — let the caller report it
}

async function fetchJson(url) {
  const res = await browserFetch(url);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

let sample;
if (SAMPLE_FILE) {
  sample = JSON.parse(readFileSync(SAMPLE_FILE, "utf8"));
} else {
  const { rows } = await fetchJson(STATS);
  const labelled = rows.filter(r => r.club);
  const size = process.argv.includes("--all")
    ? labelled.length
    : Math.min(Number(flag("n", 40)), labelled.length);

  // Evenly spaced through the archive rather than random: two runs then score
  // the same covers, so a difference in the number is the prompt and not the
  // sample.
  sample = Array.from({ length: size }, (_, i) =>
    labelled[Math.floor((i * labelled.length) / size)]);
}

async function classify(url) {
  const img = await browserFetch(url).then(r => r.arrayBuffer());
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${toBase64(img)}` } },
        ],
      }],
      max_tokens: 300,
      temperature: 0.2,
    }),
  }).then(r => r.json());

  if (!res.success) throw new Error(JSON.stringify(res.errors ?? res));
  return parseAnswer(res.result?.response);
}

const matrix = {};       // crowd -> model -> count
const misses = [];
let scored = 0;
let abstained = 0;

console.log(`${sample.length} covers, ${MODEL}\n`);

for (const [i, row] of sample.entries()) {
  let club, headline;
  try {
    ({ club, headline } = await classify(row.url));
  } catch (err) {
    console.error(`\nStopped at ${i} of ${sample.length}: ${err.message}`);
    break;
  }

  // No label is not a wrong label. Counting an abstention as a miss would hide
  // the thing worth knowing: whether the model is wrong, or just unreadable.
  if (!club) { abstained++; continue; }

  scored++;
  const tally = (matrix[row.club] ??= {});
  tally[club] = (tally[club] ?? 0) + 1;
  if (club !== row.club) misses.push({ ...row, ai: club, headline });

  process.stdout.write(club === row.club ? "." : "x");
}

if (scored === 0) { console.error("\nNothing scored."); process.exit(1); }

const agreed = scored - misses.length;
console.log(`\n\nagreement  ${(agreed / scored * 100).toFixed(1)}%  (${agreed}/${scored})`);
if (abstained) console.log(`abstained  ${abstained}  (no ANSWER: in the reply — retried by the backfill)`);

console.log("\nrecall by crowd label");
for (const c of CLUBS) {
  const seen = Object.values(matrix[c] ?? {}).reduce((a, b) => a + b, 0);
  if (seen) console.log(`  ${c.padEnd(9)} ${((matrix[c][c] ?? 0) / seen * 100).toFixed(0).padStart(3)}%  (${matrix[c][c] ?? 0}/${seen})`);
}

console.log("\nconfusion  (down: crowd, across: model)");
console.log(`  ${"".padEnd(9)}${CLUBS.map(c => c.slice(0, 5).padStart(7)).join("")}`);
for (const c of CLUBS) {
  console.log(`  ${c.padEnd(9)}${CLUBS.map(m => String(matrix[c]?.[m] ?? 0).padStart(7)).join("")}`);
}

// The headline is the whole reason a miss is diagnosable: it says what the model
// read, so a rail-box misread looks different from a genuinely ambiguous page.
if (misses.length) {
  console.log("\nmisses");
  for (const m of misses) {
    console.log(`  ${m.date} ${m.newspaper.padEnd(7)} crowd=${m.club.padEnd(9)} ai=${m.ai.padEnd(9)} ${m.headline ?? ""}`);
  }
}
