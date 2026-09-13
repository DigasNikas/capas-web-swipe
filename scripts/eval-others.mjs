#!/usr/bin/env node
/**
 * One-off experiment: is the `others` class reachable by prompt at all?
 *
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/eval-others.mjs
 *
 * The classifier's whole error budget sits in one class: covers the crowd
 * calls Restantes, which it answers with a club. This runs the same fixed
 * sample — every recent RES cover plus club-labelled controls — through four
 * prompts and prints what each one does to recall on both sides. Controls
 * matter: a prompt that says "others" more often is only a win if it doesn't
 * start calling Porto's own front page others too.
 *
 * Bare prompt, no RAG block and no headlines block, same as eval-ai.mjs: this
 * measures the page-reading, not the retrieval around it.
 *
 * Delete once the question is settled.
 */
import { MODEL, PROMPT, buildHeadlinesBlock, parseAnswer, toBase64 } from "../api/lib/ai.js";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const API = process.env.CAPAS_API ?? "https://capas-scraper.digasnikas-digital.workers.dev";
if (!ACCOUNT || !TOKEN) { console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN."); process.exit(1); }

const get = async url => {
  const res = await fetch(url, { headers: { "User-Agent": "capas-eval-others/1.0" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};

// C: the ownership judgement as its own field, the best of the first round.
const OWNS = PROMPT.replace(
  "Reply in exactly three lines:",
  "Decide first whether ONE club owns this page. If two clubs share it with " +
  "neither clearly bigger, no club owns it and the answer is others.\n" +
  "\nReply in exactly four lines:\nOWNS: <yes|no>",
);

async function classify(prompt, buffer) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${toBase64(buffer)}` } },
      ] }],
      max_tokens: 300, temperature: 0.2,
    }),
  });
  const body = await res.json();
  return parseAnswer(body?.result?.response).club;
}

const [stats, headlineRows] = await Promise.all([get(`${API}/stats`), get(`${API}/headlines`)]);
const headlines = new Map(headlineRows.map(r => [r.id, r.headlines]));
const byPaperDate = new Map(stats.rows.map(r => [`${r.newspaper}|${r.date}`, r]));
const nextDay = d => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

const labelled = stats.rows.filter(r => r.club).sort((a, b) => b.date.localeCompare(a.date));
const res = labelled.filter(r => r.club === "others").slice(0, 9);
const controls = ["sporting", "benfica", "porto"].flatMap(c => labelled.filter(r => r.club === c).slice(0, 4));
const sample = [...res, ...controls];
console.log(`sample: ${res.length} RES + ${controls.length} controls\n`);

const images = new Map();
for (const r of sample) images.set(r.cover_id, await (await fetch(r.url)).arrayBuffer());

// covers.headlines is off by one: the row for 6 September holds the titles of
// the 5 September edition (capasjornais.pt's titles page still shows
// yesterday's paper at 05:00 UTC, when the scrape runs). These two variants
// are the same prompt with the stored text and with the correct text — the
// next day's row — to size what that bug costs the classifier.
const headlinesFor = (r, shift) => {
  const row = shift ? byPaperDate.get(`${r.newspaper}|${nextDay(r.date)}`) : r;
  return buildHeadlinesBlock(row ? headlines.get(row.cover_id) : null);
};

const variants = {
  "C owns": () => OWNS,
  "C + stored text": r => headlinesFor(r, false) + OWNS,
  "C + correct text": r => headlinesFor(r, true) + OWNS,
};

const results = {};
for (const [name, promptFor] of Object.entries(variants)) {
  const answers = [];
  for (const r of sample) answers.push([r, await classify(promptFor(r), images.get(r.cover_id))]);
  results[name] = answers;
  const hit = g => { const s = answers.filter(([r]) => (g === "others" ? r.club === "others" : r.club !== "others"));
    return `${s.filter(([r, a]) => a === r.club).length}/${s.length}`; };
  console.log(`${name.padEnd(12)} RES recall ${hit("others").padEnd(6)} club recall ${hit("club")}`);
}

console.log("\nper cover (crowd → each variant):");
for (const r of sample) {
  const line = Object.keys(variants).map(n => (results[n].find(([x]) => x.cover_id === r.cover_id)[1] ?? "—").padEnd(9)).join(" ");
  console.log(`  ${r.date} ${r.newspaper.padEnd(7)} crowd=${r.club.padEnd(9)} ${line}`);
}
