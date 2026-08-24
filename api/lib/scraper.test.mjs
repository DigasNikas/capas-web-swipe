// The fallback URL is built from the date alone — one wrong slice and every
// cover 404s silently, since a dead source is a normal, logged, non-fatal
// outcome here. This is that check.
//
//   node api/lib/scraper.test.mjs
import assert from 'node:assert';
import { NEWSPAPERS, fallbackUrl } from './scraper.js';

// sapo.pt writes the date YYYYMMDD, capasjornais.pt writes it DDMMYYYY under a
// YYYYMM folder. Verified live on 2026-08-24 (200, 257 KB, 962x1232).
assert.strictEqual(
  fallbackUrl(NEWSPAPERS.find(n => n.slug === 'abola'), '20260824'),
  'https://capasjornais.pt/img/FrontPages/202608/jornal_a_bola_24082026.jpg',
);

// Single-digit day and month must keep their zero padding.
assert.strictEqual(
  fallbackUrl(NEWSPAPERS.find(n => n.slug === 'ojogo'), '20260105'),
  'https://capasjornais.pt/img/FrontPages/202601/jornal_o_jogo_05012026.jpg',
);

assert.ok(NEWSPAPERS.every(n => n.fallback), 'every paper needs a fallback slug');

console.log(`ok — ${NEWSPAPERS.length} papers, fallback urls resolve`);
