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
import { MODEL, PROMPT, parseAnswer, toBase64 } from "../api/lib/ai.js";

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

// The opening instruction is "find the largest photo, name its club", which
// forces a club before the question of ownership can arise. 6 September is
// where that bites: A Bola splits Benfica top and Sporting bottom under one
// headline, O Jogo puts a Benfica and a Sporting player in one montage. C5
// rewrites that opening instead of appending to it.
const OPEN = "Find the largest photo on the page — the one that takes up most of the visible space. " +
  "Name the football club that photo is about, then read ONLY that photo's own headline, " +
  "the text printed next to or under it.";
const OPEN5 = "Look at the photos that fill the page and the results printed with them. If one club's " +
  "photo and headline dominate, that club is the answer. If two of benfica, sporting and porto each " +
  "get their own photo and their own result — side by side, top and bottom, or together in one " +
  "montage — the page belongs to neither of them and the answer is others. Read the headline of " +
  "whichever photo is largest either way.";
const REFRAMED = PROMPT.replace(OPEN, OPEN5);
const REFRAMED_OWNS = REFRAMED.replace(
  "Reply in exactly three lines:",
  "Reply in exactly four lines:\nOWNS: <the club that owns this page, or none>",
);
const REFRAMED_BIG = REFRAMED.replace(
  "Reply in exactly three lines:",
  "Reply in exactly four lines:\nBIG: <every club with a photo filling a large part of the page>",
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

const stats = await get(`${API}/stats`);

const labelled = stats.rows.filter(r => r.club).sort((a, b) => b.date.localeCompare(a.date));
const res = labelled.filter(r => r.club === "others").slice(0, 9);
const controls = ["sporting", "benfica", "porto"].flatMap(c => labelled.filter(r => r.club === c).slice(0, 4));
const sample = [...res, ...controls];
console.log(`sample: ${res.length} RES + ${controls.length} controls\n`);

const images = new Map();
for (const r of sample) images.set(r.cover_id, await (await fetch(r.url)).arrayBuffer());

const variants = {
  "C owns": () => OWNS,
  "C5 reframed": () => REFRAMED,
  "C6 reframed+owns": () => REFRAMED_OWNS,
  "C7 reframed+big": () => REFRAMED_BIG,
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
