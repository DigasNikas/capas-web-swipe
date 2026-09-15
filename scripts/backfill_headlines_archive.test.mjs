/**
 * Self-check: node scripts/backfill_headlines_archive.test.mjs
 */
import assert from "node:assert";
import { parseArchivePage, archiveMonthUrl } from "./backfill_headlines_archive.mjs";
import { NEWSPAPERS } from "../api/lib/scraper.js";

// Fixture trimmed from a live capasjornais.pt/capas/Arquivo-Jornal-Record-Mes-agosto-2026.html
// fetch (2026-08-30): each day's permalink appears twice (thumbnail + text
// link under it), same id both times.
const ARCHIVE_FIXTURE = `
  <a href="/Capa-Jornal-Record-dia-01-Agosto-2026-103375.html" title="Capa Jornal Record de 1 agosto 2026">
  <a href="/Capa-Jornal-Record-dia-01-Agosto-2026-103375.html" style="color: #000000;">
  <a href="/Capa-Jornal-Record-dia-02-Agosto-2026-103401.html" title="Capa Jornal Record de 2 agosto 2026">
  <a href="/Capa-Jornal-Record-dia-02-Agosto-2026-103401.html" style="color: #000000;">
`;

const map = parseArchivePage(ARCHIVE_FIXTURE);
assert.strictEqual(map.get("2026-08-01"), "https://capasjornais.pt/Capa-Jornal-Record-dia-01-Agosto-2026-103375.html");
assert.strictEqual(map.get("2026-08-02"), "https://capasjornais.pt/Capa-Jornal-Record-dia-02-Agosto-2026-103401.html");
assert.strictEqual(map.size, 2, "duplicate hrefs for the same day collapse to one entry");

// março is the only month name carrying a diacritic, and the site spells it
// "Marco" in permalinks while writing "Março" in prose. Both must resolve.
const MARCH_FIXTURE = `
  <a href="/Capa-Jornal-Record-dia-05-Marco-2025-98001.html" title="x">
  <a href="/Capa-Jornal-Record-dia-06-Mar\u00e7o-2025-98002.html" title="x">
`;
const march = parseArchivePage(MARCH_FIXTURE);
assert.strictEqual(march.get("2025-03-05"), "https://capasjornais.pt/Capa-Jornal-Record-dia-05-Marco-2025-98001.html");
assert.strictEqual(march.get("2025-03-06"), "https://capasjornais.pt/Capa-Jornal-Record-dia-06-Mar\u00e7o-2025-98002.html");

// The archive URL must use the ASCII spelling: "mar\u00e7o" answers 200 with
// January's page, so a diacritic here silently backfills the wrong month.
assert.strictEqual(
  archiveMonthUrl(NEWSPAPERS.find(n => n.slug === "record"), 2025, 3),
  "https://capasjornais.pt/capas/Arquivo-Jornal-Record-Mes-marco-2025.html",
);

assert.strictEqual(parseArchivePage("<html>no covers this month</html>").size, 0);

assert.strictEqual(
  archiveMonthUrl(NEWSPAPERS.find(n => n.slug === "record"), 2026, 8),
  "https://capasjornais.pt/capas/Arquivo-Jornal-Record-Mes-agosto-2026.html",
);
assert.strictEqual(
  archiveMonthUrl(NEWSPAPERS.find(n => n.slug === "abola"), 2025, 1),
  "https://capasjornais.pt/capas/Arquivo-Jornal-A-Bola-Mes-janeiro-2025.html",
);

console.log("ok");
