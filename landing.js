const API_URL = '/api';

const CLUB_KEYS = ['sporting', 'porto', 'benfica', 'others'];
const CLUB_META = {
  sporting: { name: 'Sporting', short: 'SCP', color: 'var(--l-sporting)' },
  porto:    { name: 'Porto',    short: 'FCP', color: 'var(--l-porto)' },
  benfica:  { name: 'Benfica',  short: 'SLB', color: 'var(--l-benfica)' },
  others:   { name: 'Outros',   short: 'OTH', color: 'var(--l-others)' },
};

const MONTHS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

function prevDateStr(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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

  renderBrief(stats);
  renderPapers(stats.papers);
  renderCalendar(stats.days, matchesByDate);
  renderLatest(stats.latest);
}

function renderBrief(stats) {
  document.getElementById('stat-covers').textContent = stats.totals.covers;
  document.getElementById('stat-days').textContent = stats.days.length;
  document.getElementById('stat-votes').textContent = stats.totals.votes;
}

function renderPapers(papers) {
  const container = document.getElementById('papers');
  const sorted = [...papers].sort((a, b) => b.topPct - a.topPct);
  container.innerHTML = '';

  sorted.forEach(paper => {
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
      <div class="p-label">Jornal</div>
      <div class="p-name">${paper.name}</div>
      <div class="p-label">Clube favorito da capa</div>
      <div class="p-club">${top.name}</div>
      <div class="p-pct">${Math.round(paper.topPct * 100)}<small>%</small></div>
      ${bars}
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

function renderCalendar(days, matchesByDate) {
  let paperFilter = null;
  const calEl = document.getElementById('calendar');
  const legendEl = document.getElementById('legend');
  const panelEl = document.getElementById('day-panel');
  const eyebrowEl = document.getElementById('cal-eyebrow');
  const filterEl = document.getElementById('paper-filter');

  const papersById = { abola: 'A Bola', ojogo: 'O Jogo', record: 'Record' };

  filterEl.innerHTML = '';
  [{ id: null, name: 'Todos' }, ...Object.keys(papersById).map(id => ({ id, name: papersById[id] }))]
    .forEach(p => {
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.className = p.id === paperFilter ? 'active' : '';
      btn.addEventListener('click', () => { paperFilter = p.id; draw(); });
      filterEl.appendChild(btn);
    });

  function legendMarkup() {
    const clubs = CLUB_KEYS.map(k => `<span><i style="background:${CLUB_META[k].color}"></i>${CLUB_META[k].name}</span>`).join('');
    const noMajority = paperFilter ? '' : `<span><i style="background:var(--l-yellow)"></i>Sem maioria</span>`;
    return `${clubs}${noMajority}<span>🚨 Atenção</span>`;
  }

  function showDay(day) {
    const { unanimous, hasMajority } = dayStats(day);
    const focusClub = paperFilter ? day.covers[paperFilter] : day.winner;
    const color = (paperFilter || hasMajority) ? CLUB_META[focusClub].color : 'var(--l-yellow)';
    const pulse = pulseFor(day, matchesByDate);

    const papersHtml = Object.keys(papersById).map(id => `
      <div style="border-top:2px solid ${CLUB_META[day.covers[id]]?.color ?? 'var(--l-panel2)'}">
        <div class="dp-name">${papersById[id]}</div>
        <div class="dp-club" style="color:${day.covers[id] ? CLUB_META[day.covers[id]].color : 'var(--l-muted)'}">${day.covers[id] ? CLUB_META[day.covers[id]].short : '—'}</div>
      </div>
    `).join('');

    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

    panelEl.innerHTML = `
      <div class="l-day-body">
        <div>
          <div class="l-day-title">${dateLabel}</div>
          <div class="l-day-winner" style="color:${color}">${CLUB_META[focusClub].name}</div>
          ${pulse ? `<div class="l-day-alert">🚨 ${pulse.map(m => CLUB_META[m].name).join(' e ')} jogou ontem e não foi mencionado por todos</div>` : ''}
        </div>
        <div class="l-day-papers">${papersHtml}</div>
      </div>
    `;
  }

  function draw() {
    eyebrowEl.textContent = paperFilter
      ? `CALENDÁRIO · LENTE: ${papersById[paperFilter].toUpperCase()}`
      : 'CALENDÁRIO · 1 CLUBE POR DIA';
    [...filterEl.children].forEach((btn, i) => {
      const ids = [null, ...Object.keys(papersById)];
      btn.classList.toggle('active', ids[i] === paperFilter);
    });
    legendEl.innerHTML = legendMarkup();

    const byMonth = new Map();
    days.forEach(d => {
      const key = d.date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(d);
    });

    calEl.innerHTML = '';
    [...byMonth.entries()].forEach(([key, monthDays]) => {
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
        const { unanimous, hasMajority } = dayStats(day);
        const focusClub = paperFilter ? day.covers[paperFilter] : day.winner;
        const cell = document.createElement('div');
        cell.className = 'cal-day' + (unanimous ? ' unanimous' : hasMajority ? ' majority' : '');
        cell.style.background = (paperFilter || hasMajority) ? CLUB_META[focusClub].color : 'var(--l-yellow)';
        cell.title = `${day.date} · ${CLUB_META[focusClub].name}`;
        const pulse = pulseFor(day, matchesByDate);
        if (pulse) cell.innerHTML = '<div class="pulse">🚨</div>';
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

  const dateLabel = new Date(latest.date + 'T00:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('latest-date').textContent = `INPUT · ${dateLabel.toUpperCase()}`;

  const coversEl = document.getElementById('latest-covers');
  coversEl.innerHTML = latest.covers.map(c => `
    <div>
      <img src="${c.url}" alt="${c.name}" loading="lazy" />
      <div class="lc-name">${c.name}</div>
      <div class="lc-club" style="color:${CLUB_META[c.club].color}">${CLUB_META[c.club].name}</div>
    </div>
  `).join('');

  const winnerMeta = CLUB_META[latest.winner];
  const winnerEl = document.getElementById('latest-winner');
  winnerEl.textContent = winnerMeta.name;
  winnerEl.style.color = winnerMeta.color;

  const pct = Math.round(latest.confidence * 100);
  document.getElementById('latest-conf-fill').style.width = `${pct}%`;
  document.getElementById('latest-conf-fill').style.background = winnerMeta.color;
  document.getElementById('latest-conf-label').textContent = `${pct}% dos votos`;
}

init();
