const API_URL = '/api';

const CLUB_KEYS = ['sporting', 'porto', 'benfica', 'others'];
const CLUB_META = {
  sporting: { name: 'Sporting', short: 'SCP', color: 'var(--l-sporting)' },
  porto:    { name: 'Porto',    short: 'FCP', color: 'var(--l-porto)' },
  benfica:  { name: 'Benfica',  short: 'SLB', color: 'var(--l-benfica)' },
  others:   { name: 'Restantes', short: 'RES', color: 'var(--l-others)' },
};
const PAPERS_BY_ID = { abola: 'A Bola', ojogo: 'O Jogo', record: 'Record' };

const MONTHS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

// Local getters in, local getters out — mixing in toISOString() (UTC)
// here silently shifted this back an extra day in any positive-UTC-offset
// timezone (e.g. Europe/Lisbon in summer): local midnight on the 10th is
// still the 9th in UTC, so .toISOString() reported the 9th as local
// midnight *before* setDate even ran, making the net result two days
// back instead of one.
function prevDateStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

  const matchesByDate = new Map();
  matches.forEach(m => {
    if (!matchesByDate.has(m.match_date)) matchesByDate.set(m.match_date, []);
    matchesByDate.get(m.match_date).push(m.club);
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
  renderLatest(stats.latest);
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
      <button type="button" class="l-epoca-option${e === selected ? ' active' : ''}" data-epoca="${e}" role="option" aria-selected="${e === selected}">
        ${e === selected ? '✓' : ''} ÉPOCA ${e}
      </button>
    `).join('');
    menu.querySelectorAll('.l-epoca-option').forEach(btn => {
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
    if (!e.target.closest('.l-epoca-dropdown')) closeMenu();
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
    byDate.get(r.date).urls[r.newspaper] = r.url;
  });
  const days = [...byDate.entries()].map(([date, { covers, urls }]) => {
    const tally = Object.fromEntries(CLUB_KEYS.map(c => [c, 0]));
    Object.values(covers).forEach(c => tally[c]++);
    const winner = CLUB_KEYS.reduce((a, b) => (tally[b] > tally[a] ? b : a), CLUB_KEYS[0]);
    return { date, covers, urls, winner, tally };
  });

  renderCalendar(days, matchesByDate, epoca);
}

function renderPapers(rows) {
  const container = document.getElementById('papers');
  container.innerHTML = '';

  const papers = Object.keys(PAPERS_BY_ID).map(id => {
    const paperRows = rows.filter(r => r.newspaper === id);
    const counts = Object.fromEntries(CLUB_KEYS.map(c => [c, 0]));
    paperRows.forEach(r => counts[r.club]++);
    const total = paperRows.length;
    const topClub = CLUB_KEYS.reduce((a, b) => (counts[b] > counts[a] ? b : a), CLUB_KEYS[0]);
    return { id, name: PAPERS_BY_ID[id], counts, total, topClub, topPct: total ? counts[topClub] / total : 0 };
  }).sort((a, b) => b.topPct - a.topPct);

  papers.forEach(paper => {
    const top = CLUB_META[paper.topClub];
    const card = document.createElement('div');
    card.className = 'paper-card';
    card.style.setProperty('--club-color', top.color);

    const bars = CLUB_KEYS
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

function dayStats(day) {
  const paperIds = Object.keys(day.covers);
  const tally = day.tally;
  const winnerVotes = tally[day.winner];
  const unanimous = winnerVotes === paperIds.length;
  const hasMajority = winnerVotes > paperIds.length - winnerVotes;
  return { paperIds, unanimous, hasMajority };
}

function pulseFor(day, matchesByDate) {
  const prevMatches = matchesByDate.get(prevDateStr(day.date)) || [];
  if (prevMatches.length === 0) return null;
  const covered = new Set(Object.values(day.covers));
  const noneMentioned = prevMatches.every(m => !covered.has(m));
  const someUnmentionedMulti = prevMatches.length > 1 && prevMatches.some(m => !covered.has(m));
  const { unanimous } = dayStats(day);
  const singleNotUnanimous = prevMatches.length === 1 && !unanimous;
  if (noneMentioned || someUnmentionedMulti || singleNotUnanimous) return prevMatches;
  return null;
}

function renderCalendar(days, matchesByDate, epoca) {
  let paperFilter = null;
  const calEl = document.getElementById('calendar');
  const legendEl = document.getElementById('legend');
  const panelEl = document.getElementById('day-panel');
  const eyebrowEl = document.getElementById('cal-eyebrow');
  const filterEl = document.getElementById('paper-filter');

  filterEl.innerHTML = '';
  [{ id: null, name: 'Todos' }, ...Object.keys(PAPERS_BY_ID).map(id => ({ id, name: PAPERS_BY_ID[id] }))]
    .forEach(p => {
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.className = p.id === paperFilter ? 'active' : '';
      btn.addEventListener('click', () => { paperFilter = p.id; draw(); });
      filterEl.appendChild(btn);
    });

  function legendMarkup() {
    const clubs = CLUB_KEYS.map(k => `<span><i style="background:${CLUB_META[k].color}"></i>${CLUB_META[k].name}</span>`).join('');
    const noMajority = paperFilter ? '' : `<span><i style="background:var(--l-yellow)"></i>Inconclusivo</span>`;
    return `${clubs}${noMajority}<span>🚨 Atenção</span>`;
  }

  function showDay(day) {
    const focusClub = paperFilter ? day.covers[paperFilter] : day.winner;
    if (paperFilter && !focusClub) {
      const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
      panelEl.innerHTML = `<div class="l-day-hint">${PAPERS_BY_ID[paperFilter]} ainda não tem votos para ${dateLabel}</div>`;
      return;
    }
    const { hasMajority } = dayStats(day);
    const color = (paperFilter || hasMajority) ? CLUB_META[focusClub].color : 'var(--l-yellow)';
    const winnerLabel = (paperFilter || hasMajority) ? CLUB_META[focusClub].name : 'Inconclusivo';
    const pulse = pulseFor(day, matchesByDate);

    const papersHtml = Object.keys(PAPERS_BY_ID).map(id => {
      const club = day.covers[id];
      const url = day.urls[id];
      const cover = club && url ? `<img src="${url}" alt="${PAPERS_BY_ID[id]}" loading="lazy" />` : `<div class="dp-empty">—</div>`;
      return `
        <div>
          ${cover}
          <div class="dp-name">${PAPERS_BY_ID[id]}</div>
          <div class="dp-club" style="color:${club ? CLUB_META[club].color : 'var(--l-muted)'}">${club ? CLUB_META[club].short : '—'}</div>
        </div>
      `;
    }).join('');

    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

    panelEl.innerHTML = `
      <div class="l-day-body">
        <div>
          <div class="l-day-title">${dateLabel}</div>
          <div class="l-day-winner" style="color:${color}">${winnerLabel}</div>
          ${pulse ? `<div class="l-day-alert">🚨 ${pulse.map(m => CLUB_META[m].name).join(' e ')} jogou ontem e não foi mencionado por todos</div>` : ''}
        </div>
        <div class="l-day-papers">${papersHtml}</div>
      </div>
    `;

    panelEl.querySelectorAll('.l-day-papers img').forEach(img => {
      img.addEventListener('click', () => openCoverModal(img.src, img.alt));
    });

    if (window.innerWidth <= 760) {
      panelEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function draw() {
    eyebrowEl.textContent = paperFilter
      ? `CALENDÁRIO · ÉPOCA ${epoca} · LENTE: ${PAPERS_BY_ID[paperFilter].toUpperCase()}`
      : `CALENDÁRIO · ÉPOCA ${epoca} · 1 CLUBE POR DIA`;
    [...filterEl.children].forEach((btn, i) => {
      const ids = [null, ...Object.keys(PAPERS_BY_ID)];
      btn.classList.toggle('active', ids[i] === paperFilter);
    });
    legendEl.innerHTML = legendMarkup();
    panelEl.innerHTML = '<div class="l-day-hint">toca num dia →</div>';

    const byMonth = new Map();
    days.forEach(d => {
      const key = d.date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(d);
    });

    calEl.innerHTML = '';
    [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([key, monthDays]) => {
      const [y, m] = key.split('-');
      const block = document.createElement('div');
      block.className = 'cal-month';
      const label = document.createElement('div');
      label.className = 'cal-month-label';
      label.textContent = `${MONTHS[+m - 1]} ${y.slice(2)}`;
      block.appendChild(label);

      const grid = document.createElement('div');
      grid.className = 'cal-month-grid';
      const first = new Date(monthDays[0].date + 'T00:00:00');
      const offset = (first.getDay() + 6) % 7;
      for (let i = 0; i < offset; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-day empty';
        grid.appendChild(empty);
      }
      monthDays.forEach(day => {
        const focusClub = paperFilter ? day.covers[paperFilter] : day.winner;
        const cell = document.createElement('div');
        if (paperFilter && !focusClub) {
          cell.className = 'cal-day no-data';
          cell.style.background = 'var(--l-panel2)';
          cell.dataset.tip = `${day.date} · sem votos de ${PAPERS_BY_ID[paperFilter]}`;
        } else {
          const { unanimous, hasMajority } = dayStats(day);
          cell.className = 'cal-day' + (unanimous ? ' unanimous' : hasMajority ? ' majority' : '');
          cell.style.background = (paperFilter || hasMajority) ? CLUB_META[focusClub].color : 'var(--l-yellow)';
          cell.dataset.tip = `${day.date} · ${(paperFilter || hasMajority) ? CLUB_META[focusClub].name : 'Inconclusivo'}`;
          const pulse = pulseFor(day, matchesByDate);
          if (pulse) cell.innerHTML = '<div class="pulse">🚨</div>';
        }
        cell.addEventListener('click', () => showDay(day));
        grid.appendChild(cell);
      });

      block.appendChild(grid);
      calEl.appendChild(block);
    });
  }

  draw();
}

function renderLatest(latest) {
  if (!latest) return;
  const section = document.getElementById('latest');
  section.classList.remove('hidden');

  fitTextToContainer(document.getElementById('latest-title'), 2.6, 1);

  const dateLabel = new Date(latest.date + 'T00:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('latest-date').textContent = `INPUT · ${dateLabel.toUpperCase()}`;

  const coversEl = document.getElementById('latest-covers');
  coversEl.innerHTML = '';
  latest.covers.forEach(c => {
    const div = document.createElement('div');
    div.innerHTML = `
      <img src="${c.url}" alt="${c.name}" loading="lazy" />
      <div class="lc-name">${c.name}</div>
      <div class="lc-club" style="color:${CLUB_META[c.club].color}">${CLUB_META[c.club].name}</div>
    `;
    div.querySelector('img').addEventListener('click', () => openCoverModal(c.url, c.name));
    coversEl.appendChild(div);
  });

  const winnerEl = document.getElementById('latest-winner');
  const winnerColor = latest.hasMajority ? CLUB_META[latest.winner].color : 'var(--l-yellow)';
  winnerEl.textContent = latest.hasMajority ? CLUB_META[latest.winner].name : 'Empate técnico';
  winnerEl.style.color = winnerColor;
  fitTextToContainer(winnerEl, 4.5, 1);

  const pct = Math.round(latest.confidence * 100);
  document.getElementById('latest-conf-fill').style.width = `${pct}%`;
  document.getElementById('latest-conf-fill').style.background = winnerColor;
  document.getElementById('latest-conf-label').textContent = `${pct}% dos votos`;
}

// Shrinks font-size until the (single-line) text fits its container —
// club names range from "Porto" to "Empate técnico", too wide a spread
// for one fixed clamp() to keep on one line at every length.
function fitTextToContainer(el, maxRem = 4.5, minRem = 1.6) {
  let size = maxRem;
  el.style.fontSize = `${size}rem`;
  while (el.scrollWidth > el.clientWidth && size > minRem) {
    size -= 0.15;
    el.style.fontSize = `${size}rem`;
  }
}

function openCoverModal(url, name) {
  const modal = document.getElementById('cover-modal');
  document.getElementById('cover-modal-img').src = url;
  document.getElementById('cover-modal-img').alt = name;
  modal.classList.remove('hidden');
}

function closeCoverModal() {
  document.getElementById('cover-modal').classList.add('hidden');
  document.getElementById('cover-modal-img').src = '';
}

document.getElementById('cover-modal').addEventListener('click', closeCoverModal);
document.getElementById('cover-modal-close').addEventListener('click', closeCoverModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCoverModal(); });

init();
