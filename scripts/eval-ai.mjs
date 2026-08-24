#!/usr/bin/env node
/**
 * Score the prompt in api/lib/ai.js against the crowd labels — without
 * deploying, without touching D1, without re-running the backfill.
 *
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/eval-ai.mjs
 *   ... node scripts/eval-ai.mjs --n 80        # bigger sample
 *   ... node scripts/eval-ai.mjs --all         # every labelled cover, ~579 calls
 *
 * The token needs Workers AI · Read. Everything else is public: the labels come
 * from /api/stats and the covers from R2's public URLs, so no D1 credentials.
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
import { MODEL, PROMPT, CLUBS, parseAnswer, toBase64 } from "../api/lib/ai.js";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const STATS = process.env.CAPAS_STATS ?? "https://capas.digasnikas.com/api/stats";

if (!ACCOUNT || !TOKEN) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI · Read).");
  process.exit(1);
}

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const { rows } = await fetch(STATS).then(r => r.json());
const labelled = rows.filter(r => r.club);
const size = process.argv.includes("--all")
  ? labelled.length
  : Math.min(Number(flag("n", 40)), labelled.length);

// Evenly spaced through the archive rather than random: two runs then score the
// same covers, so a difference in the number is the prompt and not the sample.
const sample = Array.from({ length: size }, (_, i) =>
  labelled[Math.floor((i * labelled.length) / size)]);

async function classify(url) {
  const img = await fetch(url).then(r => r.arrayBuffer());
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

console.log(`${size} covers, ${MODEL}\n`);

for (const [i, row] of sample.entries()) {
  let club, headline;
  try {
    ({ club, headline } = await classify(row.url));
  } catch (err) {
    console.error(`\nStopped at ${i} of ${size}: ${err.message}`);
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
