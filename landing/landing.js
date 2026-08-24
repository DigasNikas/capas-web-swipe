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
  renderVerdict('latest', stats.latest, 'dos votos');
  renderAi(stats.latestAi, stats.latest);
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
    byDate.get(r.date).urls[r.newspaper] = { url: r.url, thumb: r.thumb_url };
  });
  const days = [...byDate.entries()].map(([date, { covers, urls }]) => {
    const tally = Object.fromEntries(CLUB_KEYS.map(c => [c, 0]));
    Object.values(covers).forEach(c => tally[c]++);
    const winner = CLUB_KEYS.reduce((a, b) => (tally[b] > tally[a] ? b : a), CLUB_KEYS[0]);
    return { date, covers, urls, winner, tally };
  });

  renderSuspeito(computeSuspeito(days, matchesByDate), epoca);
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

// Which of yesterday's match clubs got unfairly snubbed today, and by
// which papers. A club is only snubbed when a specific rival — a club
// that didn't itself play that day, and isn't Restantes — took the front
// page instead. Restantes means a bigger, unrelated story; another club
// from prevMatches is an equally legitimate story on a multi-match day.
// Neither is evidence anyone was hidden on purpose, so neither counts
// against the paper that picked it.
function snubInfoFor(day, matchesByDate) {
  const prevMatches = matchesByDate.get(prevDateStr(day.date)) || [];
  if (prevMatches.length === 0) return { prevMatches, offendersByClub: {} };

  const covered = new Set(Object.values(day.covers));
  const alsoPlayed = new Set(prevMatches);
  const paperIds = Object.keys(day.covers);

  const offendersOf = club => paperIds.filter(p => {
    const c = day.covers[p];
    return c !== 'others' && c !== club && !alsoPlayed.has(c);
  });

  // On a multi-match day, only a club with zero coverage is even a
  // candidate — one that got some coverage already wasn't snubbed just
  // because another paper covered a co-match rival instead.
  const candidates = prevMatches.length > 1 ? prevMatches.filter(m => !covered.has(m)) : prevMatches;

  const offendersByClub = {};
  candidates.forEach(club => {
    const offenders = offendersOf(club);
    if (offenders.length) offendersByClub[club] = offenders;
  });

  return { prevMatches, offendersByClub };
}

function pulseFor(day, matchesByDate) {
  const snubbed = Object.keys(snubInfoFor(day, matchesByDate).offendersByClub);
  return snubbed.length ? snubbed : null;
}

function computeSuspeito(days, matchesByDate) {
  const offenderCounts = {};
  const victimCounts = {};
  const incidents = [];
  days.forEach(day => {
    const { offendersByClub } = snubInfoFor(day, matchesByDate);
    Object.entries(offendersByClub).forEach(([club, offenders]) => {
      victimCounts[club] = (victimCounts[club] || 0) + 1;
      offenders.forEach(p => { offenderCounts[p] = (offenderCounts[p] || 0) + 1; });
      incidents.push({ date: day.date, club, offenders });
    });
  });
  incidents.sort((a, b) => a.date.localeCompare(b.date));
  return { offenderCounts, victimCounts, incidents };
}

function suspeitoRowsHtml(rows, nameOf) {
  return rows.length
    ? rows.map(([id, n]) => `<div class="s-row"><span class="s-name">${nameOf(id)}</span><span class="s-count">${n}</span></div>`).join('')
    : '<div class="s-empty">Sem incidentes nesta época.</div>';
}

function renderSuspeito(stats, epoca) {
  document.getElementById('suspeito').classList.remove('hidden');
  document.getElementById('suspeito-eyebrow').textContent = `O SUSPEITO · ÉPOCA ${epoca}`;

  const resultsEl = document.getElementById('suspeito-results');
  const btn = document.getElementById('btn-suspeito-reveal');
  resultsEl.classList.add('hidden');
  resultsEl.innerHTML = '';
  btn.classList.remove('hidden');

  btn.onclick = () => {
    const { offenderCounts, victimCounts, incidents } = stats;
    const offenderRows = Object.entries(offenderCounts).sort((a, b) => b[1] - a[1]);
    const victimRows = Object.entries(victimCounts).sort((a, b) => b[1] - a[1]);

    resultsEl.innerHTML = `
      <div class="s-card">
        <h3>Ofensor · por jornal</h3>
        ${suspeitoRowsHtml(offenderRows, id => PAPERS_BY_ID[id] || id)}
      </div>
      <div class="s-card">
        <h3>Vítima · por clube</h3>
        ${suspeitoRowsHtml(victimRows, id => CLUB_META[id].name)}
      </div>
      <div class="s-card l-suspeito-incidents">
        <h3>Incidentes (${incidents.length})</h3>
        ${incidents.length ? incidents.map(i => `
          <div class="s-inc"><b>${i.date}</b> · ${CLUB_META[i.club].name} ignorado por ${i.offenders.map(p => PAPERS_BY_ID[p] || p).join(', ')}</div>
        `).join('') : '<div class="s-empty">Sem incidentes nesta época.</div>'}
      </div>
    `;
    resultsEl.classList.remove('hidden');
    btn.classList.add('hidden');
  };
}

function renderCalendar(days, matchesByDate, epoca) {
  let paperFilter = null;
  let selectedCell = null;
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
      const u = day.urls[id];
      const cover = club && u ? `<img src="${u.thumb}" data-full="${u.url}" alt="${PAPERS_BY_ID[id]}" loading="lazy" />` : `<div class="dp-empty">—</div>`;
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
      img.addEventListener('click', () => openCoverModal(img.dataset.full, img.alt));
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
        cell.addEventListener('click', () => {
          if (selectedCell) selectedCell.classList.remove('selected');
          cell.classList.add('selected');
          selectedCell = cell;
          showDay(day);
        });
        grid.appendChild(cell);
      });

      block.appendChild(grid);
      calEl.appendChild(block);
    });
  }

  draw();
}

// Renders one verdict card — the crowd's ("latest") or the model's ("ai").
// Both sections have the same markup under a different id prefix and share the
// .l-latest* styles; only the source of `club` and the unit label differ.
function renderVerdict(id, data, unit) {
  if (!data) return;
  document.getElementById(id).classList.remove('hidden');

  fitTextToContainer(document.getElementById(`${id}-title`), 2.6, 1);

  const dateLabel = new Date(data.date + 'T00:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById(`${id}-date`).textContent = `INPUT · ${dateLabel.toUpperCase()}`;

  const coversEl = document.getElementById(`${id}-covers`);
  coversEl.innerHTML = '';
  data.covers.forEach(c => {
    const div = document.createElement('div');
    div.innerHTML = `
      <img src="${c.thumb_url}" alt="${c.name}" loading="lazy" />
      <div class="lc-name">${c.name}</div>
      <div class="lc-club" style="color:${CLUB_META[c.club].color}">${CLUB_META[c.club].name}</div>
    `;
    div.querySelector('img').addEventListener('click', () => openCoverModal(c.url, c.name));
    coversEl.appendChild(div);
  });

  const winnerEl = document.getElementById(`${id}-winner`);
  const winnerColor = data.hasMajority ? CLUB_META[data.winner].color : 'var(--l-yellow)';
  winnerEl.textContent = data.hasMajority ? CLUB_META[data.winner].name : 'Empate técnico';
  winnerEl.style.color = winnerColor;
  fitTextToContainer(winnerEl, 4.5, 1);

  const pct = Math.round(data.confidence * 100);
  document.getElementById(`${id}-conf-fill`).style.width = `${pct}%`;
  document.getElementById(`${id}-conf-fill`).style.background = winnerColor;
  document.getElementById(`${id}-conf-label`).textContent = `${pct}% ${unit}`;
}

function renderAi(latestAi, latest) {
  renderVerdict('ai', latestAi, 'dos jornais');
  if (!latestAi) return;

  const pct = Math.round(latestAi.agreement * 100);
  document.getElementById('ai-agreement').textContent =
    `Concorda com a comunidade em ${pct}% das ${latestAi.labelled} capas já analisadas.`;

  const same = latest && latest.winner === latestAi.winner;
  const verdictEl = document.getElementById('ai-vs-human');
  verdictEl.textContent = same ? 'HOJE · CONCORDA COM A COMUNIDADE' : 'HOJE · DISCORDA DA COMUNIDADE';
  verdictEl.classList.toggle('disagrees', !same);
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

/* ── Comentários ─────────────────────────────────────────────────────────
   Only ever attached to the newest cover day. Google sign-in is the only
   gate — no accounts, no profiles, nothing that outlives the day.        */

// Public OAuth client ID (same Google client as the Cloudflare Access IdP).
// Requires https://capas.digasnikas.com in its Authorized JavaScript origins.
const GOOGLE_CLIENT_ID = '107331929504-16jvt0ml8gago9iofrd2sqtg1barsob6.apps.googleusercontent.com';
const SESSION_KEY = 'capas_gid';

// The raw Google ID token. sessionStorage, not localStorage: it dies with
// the tab, which matches how long a comment lives anyway.
let session = sessionStorage.getItem(SESSION_KEY);

async function initComments() {
  const res = await fetch(`${API_URL}/comments`);
  if (!res.ok) return;
  const { comments } = await res.json();

  renderComments(comments);
  renderCommentAuth();
  document.getElementById('comments-form').addEventListener('submit', submitComment);
}

function renderComments(list) {
  const el = document.getElementById('comments-list');
  el.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'l-comments-empty';
    empty.textContent = 'Ainda ninguém disse nada. Começa tu.';
    el.appendChild(empty);
    return;
  }
  list.forEach(c => el.appendChild(commentEl(c)));
}

// textContent only — this is the one place on the page rendering text a
// stranger wrote. Do not switch it to innerHTML to match the rest of the file.
function commentEl(c) {
  const row = document.createElement('article');
  row.className = 'l-comment';

  const who = document.createElement('span');
  who.className = 'l-comment-who';
  who.textContent = c.author;

  const when = document.createElement('span');
  when.className = 'l-comment-when';
  when.textContent = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit' })
    .format(new Date(c.created_at.replace(' ', 'T') + 'Z'));

  const meta = document.createElement('div');
  meta.className = 'l-comment-meta';
  meta.append(who, when);

  const body = document.createElement('p');
  body.className = 'l-comment-body';
  body.textContent = c.body;

  row.append(meta, body);
  return row;
}

function renderCommentAuth() {
  const el = document.getElementById('comment-auth');
  el.innerHTML = '';

  if (session) {
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'l-cta l-cta-small';
    send.textContent = 'Comentar →';

    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'l-comments-signout';
    out.textContent = 'sair';
    out.addEventListener('click', () => { setSession(null); renderCommentAuth(); });

    el.append(send, out);
    return;
  }

  const hint = document.createElement('span');
  hint.className = 'l-comments-hint';
  hint.textContent = 'Entra para comentar';
  const slot = document.createElement('div');
  el.append(hint, slot);

  whenGis(() => {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
    google.accounts.id.renderButton(slot, {
      theme: 'filled_black', size: 'medium', shape: 'pill', text: 'signin_with', locale: 'pt-PT',
    });
  });
}

// The GIS script is async, so it may land before or after this module runs.
function whenGis(cb) {
  if (window.google?.accounts?.id) return cb();
  document.getElementById('gsi').addEventListener('load', cb, { once: true });
}

function onGoogleCredential(response) {
  setSession(response.credential);
  renderCommentAuth();
  document.getElementById('comment-body').focus();
}

function setSession(token) {
  session = token;
  if (token) sessionStorage.setItem(SESSION_KEY, token);
  else sessionStorage.removeItem(SESSION_KEY);
}

async function submitComment(e) {
  e.preventDefault();
  const bodyEl = document.getElementById('comment-body');
  const errEl  = document.getElementById('comment-error');
  const btn    = e.target.querySelector('button[type="submit"]');
  const body   = bodyEl.value.trim();
  if (!body || !session || !btn) return;

  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'A enviar…';

  let res, data;
  try {
    res = await fetch(`${API_URL}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: session, body }),
    });
    data = await res.json();
  } catch {
    errEl.textContent = 'Sem ligação. Tenta outra vez.';
    btn.disabled = false;
    btn.textContent = 'Comentar →';
    return;
  }

  if (!res.ok) {
    errEl.textContent = data?.error || 'Não foi possível enviar.';
    // The Google ID token lasts an hour; past that, sign in again.
    if (res.status === 401) setSession(null);
    renderCommentAuth();
    return;
  }

  bodyEl.value = '';
  const list = document.getElementById('comments-list');
  list.querySelector('.l-comments-empty')?.remove();
  list.appendChild(commentEl(data));
  renderCommentAuth();
}

init();
