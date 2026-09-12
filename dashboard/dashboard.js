// Composition root: fetch the data, then hand it to each section.
import { CLUB_IDS, PAPER_NAMES } from '/src/domain.js';
import { API_URL, CLUB_META } from '/src/common.js';
import { computeSuspeito, renderBarcode, renderCalendar, renderSuspeito } from '/src/calendar.js';
import { renderAi, renderVerdict } from '/src/verdict.js';
import { renderAvgCovers } from '/src/averages.js';
import { initComments } from '/src/comments.js';

// Época = Aug 1 → Jun 30. Dates in July belong to no época (off-season gap).
function epocaLabelForDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const y = d.getFullYear(), m = d.getMonth(); // 0-indexed, Aug=7, Jun=5
  let startYear;
  if (m >= 7) startYear = y;
  else if (m <= 5) startYear = y - 1;
  else return null;
  return `${String(startYear % 100).padStart(2, '0')}/${String((startYear + 1) % 100).padStart(2, '0')}`;
}

async function init() {
  const [statsRes, matchesRes] = await Promise.all([
    fetch(`${API_URL}/stats`),
    fetch(`${API_URL}/matches`),
  ]);
  if (!statsRes.ok) return;
  const stats = await statsRes.json();
  const matches = matchesRes.ok ? await matchesRes.json() : [];

  // date -> [{ club, competition }]. The competition is what lets the
  // calendar's 🚨 name it; it is null for rows imported before that column.
  const matchesByDate = new Map();
  matches.forEach(m => {
    if (!matchesByDate.has(m.match_date)) matchesByDate.set(m.match_date, []);
    matchesByDate.get(m.match_date).push({ club: m.club, competition: m.competition ?? null });
  });

  const rows = stats.rows.map(r => ({ ...r, epoca: epocaLabelForDate(r.date) })).filter(r => r.epoca);

  const countByEpoca = new Map();
  rows.forEach(r => countByEpoca.set(r.epoca, (countByEpoca.get(r.epoca) || 0) + 1));
  const epocas = [...countByEpoca.keys()].sort().reverse();
  // Default to whichever época today's date actually falls in; if it has
  // no data yet (season just started, or we're in the July gap), fall
  // back to the most recent época that does.
  const todayEpoca = epocaLabelForDate(new Date().toISOString().slice(0, 10));
  const defaultEpoca = epocas.includes(todayEpoca) ? todayEpoca : epocas[0];

  setupEpocaDropdown(epocas, defaultEpoca, e => renderEpoca(rows, e, matchesByDate));

  renderEpoca(rows, defaultEpoca, matchesByDate);
  renderVerdict('latest', stats.latest, 'dos votos');
  renderAi(stats.latestAi, stats.latest, stats.rows);
  renderAvgCovers();
  if (stats.latest) initComments();
}

// Custom dropdown, not a native <select> — the open <option> list is
// OS-rendered on Chrome/macOS and mostly ignores CSS (blue highlight,
// system font), so it can't be made to match the site's design.
function setupEpocaDropdown(epocas, selected, onSelect) {
  const trigger = document.getElementById('epoca-trigger');
  const menu = document.getElementById('epoca-menu');

  function renderTrigger() {
    trigger.textContent = `ÉPOCA ${selected} ▾`;
  }

  function renderMenu() {
    menu.innerHTML = epocas.map(e => `
      <button type="button" class="d-epoca-option${e === selected ? ' active' : ''}" data-epoca="${e}" role="option" aria-selected="${e === selected}">
        ${e === selected ? '✓' : ''} ÉPOCA ${e}
      </button>
    `).join('');
    menu.querySelectorAll('.d-epoca-option').forEach(btn => {
      btn.addEventListener('click', () => {
        selected = btn.dataset.epoca;
        renderTrigger();
        renderMenu();
        closeMenu();
        onSelect(selected);
      });
    });
  }

  function openMenu() {
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', () => {
    menu.classList.contains('hidden') ? openMenu() : closeMenu();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.d-epoca-dropdown')) closeMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
  });

  renderTrigger();
  renderMenu();
}

function renderEpoca(rows, epoca, matchesByDate) {
  const epocaRows = rows.filter(r => r.epoca === epoca);

  document.getElementById('papers-eyebrow').textContent = `O VEREDICTO · ÉPOCA ${epoca}`;

  const dias = new Set(epocaRows.map(r => r.date)).size;
  const votes = epocaRows.reduce((sum, r) => sum + r.votes_total, 0);
  document.getElementById('stat-covers').textContent = epocaRows.length;
  document.getElementById('stat-days').textContent = dias;
  document.getElementById('stat-votes').textContent = votes;

  renderPapers(epocaRows);

  const byDate = new Map();
  epocaRows.forEach(r => {
    if (!byDate.has(r.date)) byDate.set(r.date, { covers: {}, urls: {} });
    byDate.get(r.date).covers[r.newspaper] = r.club;
    byDate.get(r.date).urls[r.newspaper] = { url: r.url, thumb: r.thumb_url };
  });
  const days = [...byDate.entries()].map(([date, { covers, urls }]) => {
    const tally = Object.fromEntries(CLUB_IDS.map(c => [c, 0]));
    Object.values(covers).forEach(c => tally[c]++);
    const winner = CLUB_IDS.reduce((a, b) => (tally[b] > tally[a] ? b : a), CLUB_IDS[0]);
    return { date, covers, urls, winner, tally };
  });

  renderSuspeito(computeSuspeito(days, matchesByDate), epoca);
  // Each needs to call into the other (a click on either selects the same
  // day in both), so the barcode's onSelect closes over this binding rather
  // than the two functions taking each other as arguments directly.
  let selectCalendarDay;
  const { highlightDay: highlightBarcodeDay, filterPaper: filterBarcodeRows } =
    renderBarcode(days, date => selectCalendarDay?.(date));
  selectCalendarDay = renderCalendar(days, matchesByDate, epoca, highlightBarcodeDay, filterBarcodeRows);
}

function renderPapers(rows) {
  const container = document.getElementById('papers');
  container.innerHTML = '';

  const papers = Object.keys(PAPER_NAMES).map(id => {
    const paperRows = rows.filter(r => r.newspaper === id);
    const counts = Object.fromEntries(CLUB_IDS.map(c => [c, 0]));
    paperRows.forEach(r => counts[r.club]++);
    const total = paperRows.length;
    const topClub = CLUB_IDS.reduce((a, b) => (counts[b] > counts[a] ? b : a), CLUB_IDS[0]);
    return { id, name: PAPER_NAMES[id], counts, total, topClub, topPct: total ? counts[topClub] / total : 0 };
  }).sort((a, b) => b.topPct - a.topPct);

  papers.forEach(paper => {
    const top = CLUB_META[paper.topClub];
    const card = document.createElement('div');
    card.className = 'paper-card';
    card.style.setProperty('--club-color', top.color);

    const bars = CLUB_IDS
      .map(k => ({ k, count: paper.counts[k] }))
      .sort((a, b) => b.count - a.count)
      .map(({ k, count }) => {
        const pct = paper.total ? Math.round((count / paper.total) * 100) : 0;
        return `
          <div class="p-bar-row">
            <span class="p-bar-key">${CLUB_META[k].short}</span>
            <span class="p-bar-track"><span class="p-bar-fill" style="width:${pct}%;background:${CLUB_META[k].color}"></span></span>
            <span class="p-bar-val">${pct}%</span>
          </div>`;
      }).join('');

    card.innerHTML = `
      <div class="p-wash"></div>
      <div class="p-edge"></div>
      <div class="p-content">
        <div class="p-label">Jornal</div>
        <div class="p-name">${paper.name}</div>
        <div class="p-label">Clube favorito da capa</div>
        <div class="p-club">${top.name}</div>
        <div class="p-pct">${Math.round(paper.topPct * 100)}<small>%</small></div>
        ${bars}
      </div>
    `;
    container.appendChild(card);
  });
}

init();
