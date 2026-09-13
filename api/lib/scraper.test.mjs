// The capasjornais.pt URL is built from the date alone — one wrong slice and
// every cover 404s silently, since a dead source is a normal, logged,
// non-fatal outcome here. This is that check.
//
//   node api/lib/scraper.test.mjs
import assert from 'node:assert';
import { NEWSPAPERS, capasjornaisUrl, extractHeadlinesFromHtml, headlinesIfFresh } from './scraper.js';

// sapo.pt writes the date YYYYMMDD, capasjornais.pt writes it DDMMYYYY under a
// YYYYMM folder. Verified live on 2026-08-24 (200, 257 KB, 962x1232).
assert.strictEqual(
  capasjornaisUrl(NEWSPAPERS.find(n => n.slug === 'abola'), '20260824'),
  'https://capasjornais.pt/img/FrontPages/202608/jornal_a_bola_24082026.jpg',
);

// Single-digit day and month must keep their zero padding.
assert.strictEqual(
  capasjornaisUrl(NEWSPAPERS.find(n => n.slug === 'ojogo'), '20260105'),
  'https://capasjornais.pt/img/FrontPages/202601/jornal_o_jogo_05012026.jpg',
);

assert.ok(NEWSPAPERS.every(n => n.capasjornais), 'every paper needs a capasjornais slug');
assert.ok(NEWSPAPERS.every(n => n.sapoUrl), 'every paper needs a sapo.pt fallback URL');
assert.ok(NEWSPAPERS.every(n => n.capasjornaisPage), 'every paper needs a capasjornais.pt page slug');

console.log(`ok — ${NEWSPAPERS.length} papers, capasjornais.pt urls resolve`);

// Fixture trimmed from a live capasjornais.pt/Capa-Jornal-Record.html fetch
// (2026-08-30): the "Títulos da Capa" block is a single <li><span> holding
// every headline already "•"-joined, with unrelated markup around it.
const HEADLINES_FIXTURE = `
  <a href="..." class="fa fa-whatsapp sharebtn"></a>
  <!--Headlines-->
  <div class="row" style="min-width: 210px; margin: 5px">
    <h2 class="BottomNews" style="margin: 0px;">Títulos da Capa Jornal Record de domingo, 30 de agosto 2026</h2>
    <ul style="max-width: 728px;">
      <li style="margin-top: 6px; list-style: square;"><span style="color: inherit; font-size: 14px;">Palhinha já é da casa • Empréstimo pode ser solução para Ríos e Trubin • Zaidu com suspeita de lesão grave</span></li>
    </ul>
  </div>
  <a href="..." class="btn btn-success">Ver Comentários</a>
`;

assert.deepStrictEqual(
  extractHeadlinesFromHtml(HEADLINES_FIXTURE),
  {
    date: '2026-08-30',
    text: 'Palhinha já é da casa • Empréstimo pode ser solução para Ríos e Trubin • Zaidu com suspeita de lesão grave',
  },
);

assert.strictEqual(
  extractHeadlinesFromHtml('<html><body>no headlines section here</body></html>'),
  null,
  'missing BottomNews marker should yield null, not throw',
);

// The page has no date parameter: it serves whichever edition it has at the
// moment. At 05:00 UTC, when the scrape cron runs, that is still yesterday's
// paper — which is how every cover in the archive ended up filed with the
// previous day's headlines. The heading says which edition it is, so the text
// is only taken when that matches the cover being saved.
assert.strictEqual(
  headlinesIfFresh(HEADLINES_FIXTURE, '2026-08-30'),
  'Palhinha já é da casa • Empréstimo pode ser solução para Ríos e Trubin • Zaidu com suspeita de lesão grave',
);
assert.strictEqual(headlinesIfFresh(HEADLINES_FIXTURE, '2026-08-31'), null, 'yesterday\'s edition is not this cover');
assert.strictEqual(headlinesIfFresh(HEADLINES_FIXTURE, '2026-08-29'), null, 'nor tomorrow\'s');
assert.strictEqual(headlinesIfFresh('<html>nothing</html>', '2026-08-30'), null);

// Every month name the heading can carry, and the zero padding.
const heading = (d, m, y) => `<h2 class="BottomNews">Títulos da Capa Jornal Record de sexta, ${d} de ${m} ${y}</h2><ul><li><span>x</span></li></ul>`;
assert.strictEqual(extractHeadlinesFromHtml(heading(1, 'janeiro', 2027)).date, '2027-01-01');
assert.strictEqual(extractHeadlinesFromHtml(heading(9, 'março', 2027)).date, '2027-03-09');
assert.strictEqual(extractHeadlinesFromHtml(heading(31, 'dezembro', 2026)).date, '2026-12-31');
assert.strictEqual(extractHeadlinesFromHtml(heading(5, 'brumário', 2026)).date, null, 'an unreadable date is not a date');

console.log('ok — headline extraction reads the BottomNews block and its edition date');
