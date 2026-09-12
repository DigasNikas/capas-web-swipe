// Calendar, barcode and "O suspeito": everything built from one época's days.
import { CLUB_IDS, COMPETITION_NAMES, PAPER_NAMES, euroCompetition } from '/src/domain.js';
import { CLUB_META, MONTHS, joinList } from '/src/common.js';
import { openCoverModal } from '/src/cover-modal.js';
import { pulseMessage } from '/src/pulse.js';

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
  const played = matchesByDate.get(prevDateStr(day.date)) || [];
  const prevMatches = played.map(m => m.club);
  if (prevMatches.length === 0) return { played, prevMatches, offendersByClub: {} };

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

  return { played, prevMatches, offendersByClub };
}

// What the 🚨 says, or null when there is nothing to complain about. A club
// that was the only one playing is the unfair case worth naming — see
// dashboard/src/pulse.js for the wording.
function pulseFor(day, matchesByDate) {
  const { played, offendersByClub } = snubInfoFor(day, matchesByDate);
  const snubbed = Object.keys(offendersByClub);
  if (!snubbed.length) return null;
  return {
    names: snubbed.map(c => CLUB_META[c].name),
    onlyOne: played.length === 1,
    competition: COMPETITION_NAMES[played[0]?.competition] ?? null,
  };
}

export function computeSuspeito(days, matchesByDate) {
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

function suspeitoResultsHtml(stats) {
  const { offenderCounts, victimCounts, incidents } = stats;
  const offenderRows = Object.entries(offenderCounts).sort((a, b) => b[1] - a[1]);
  const victimRows = Object.entries(victimCounts).sort((a, b) => b[1] - a[1]);

  return `
    <div class="s-card">
      <h3>Ofensor · por jornal</h3>
      ${suspeitoRowsHtml(offenderRows, id => PAPER_NAMES[id] || id)}
    </div>
    <div class="s-card">
      <h3>Vítima · por clube</h3>
      ${suspeitoRowsHtml(victimRows, id => CLUB_META[id].name)}
    </div>
    <div class="s-card d-suspeito-incidents">
      <h3>Incidentes (${incidents.length})</h3>
      ${incidents.length ? incidents.map(i => `
        <div class="s-inc"><b>${i.date}</b> · ${CLUB_META[i.club].name} ignorado por ${joinList(i.offenders.map(p => PAPER_NAMES[p] || p))}</div>
      `).join('') : '<div class="s-empty">Sem incidentes nesta época.</div>'}
    </div>
  `;
}

export function renderSuspeito(stats, epoca) {
  document.getElementById('suspeito').classList.remove('hidden');
  document.getElementById('suspeito-eyebrow').textContent = `O SUSPEITO · ÉPOCA ${epoca}`;

  const resultsEl = document.getElementById('suspeito-results');
  const btn = document.getElementById('btn-suspeito-reveal');
  let revealed = false;
  resultsEl.classList.add('hidden');
  resultsEl.innerHTML = '';
  btn.classList.remove('hidden');
  btn.textContent = 'Revelar o suspeito';

  btn.onclick = () => {
    revealed = !revealed;
    if (revealed && !resultsEl.innerHTML) resultsEl.innerHTML = suspeitoResultsHtml(stats);
    resultsEl.classList.toggle('hidden', !revealed);
    btn.textContent = revealed ? 'Esconder' : 'Revelar o suspeito';
  };
}

export function renderCalendar(days, matchesByDate, epoca, highlightBarcodeDay, filterBarcodeRows) {
  let paperFilter = null;
  let selectedCell = null;
  const calEl = document.getElementById('calendar');
  const legendEl = document.getElementById('legend');
  const panelEl = document.getElementById('day-panel');
  const eyebrowEl = document.getElementById('cal-eyebrow');
  const filterEl = document.getElementById('paper-filter');

  filterEl.innerHTML = '';
  [{ id: null, name: 'Todos' }, ...Object.keys(PAPER_NAMES).map(id => ({ id, name: PAPER_NAMES[id] }))]
    .forEach(p => {
      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.className = p.id === paperFilter ? 'active' : '';
      btn.addEventListener('click', () => { paperFilter = p.id; draw(); });
      filterEl.appendChild(btn);
    });

  function legendMarkup() {
    const clubs = CLUB_IDS.map(k => `<span><i style="background:${CLUB_META[k].color}"></i>${CLUB_META[k].name}</span>`).join('');
    const noMajority = paperFilter ? '' : `<span><i style="background:var(--d-yellow)"></i>Inconclusivo</span>`;
    return `${clubs}${noMajority}<span>🚨 Atenção</span>`;
  }

  function showDay(day) {
    const focusClub = paperFilter ? day.covers[paperFilter] : day.winner;
    if (paperFilter && !focusClub) {
      const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
      panelEl.innerHTML = `<div class="d-day-hint">${PAPER_NAMES[paperFilter]} ainda não tem votos para ${dateLabel}</div>`;
      return;
    }
    const { hasMajority } = dayStats(day);
    const color = (paperFilter || hasMajority) ? CLUB_META[focusClub].color : 'var(--d-yellow)';
    const winnerLabel = (paperFilter || hasMajority) ? CLUB_META[focusClub].name : 'Inconclusivo';
    const pulse = pulseFor(day, matchesByDate);
    // A European night is a different kind of front page, so the whole block
    // of covers from the morning after carries that competition's banner.
    const euro = euroCompetition(matchesByDate.get(prevDateStr(day.date)) || []);

    const papersHtml = Object.keys(PAPER_NAMES).map(id => {
      const club = day.covers[id];
      const u = day.urls[id];
      const cover = club && u
        ? `<img src="${u.thumb}" data-full="${u.url}" alt="${PAPER_NAMES[id]}" loading="lazy" />`
        : `<div class="dp-empty">—</div>`;
      return `
        <div>
          ${cover}
          <div class="dp-name">${PAPER_NAMES[id]}</div>
          <div class="dp-club" style="color:${club ? CLUB_META[club].color : 'var(--d-muted)'}">${club ? CLUB_META[club].short : '—'}</div>
        </div>
      `;
    }).join('');

    const dateLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();

    panelEl.innerHTML = `
      <div class="d-day-body">
        <div>
          <div class="d-day-title">${dateLabel}</div>
          <div class="d-day-winner" style="color:${color}">${winnerLabel}</div>
          ${pulse ? `<div class="d-day-alert">🚨 ${pulseMessage(pulse.names, pulse)}</div>` : ''}
        </div>
        <div class="d-day-covers${euro ? ` dp-euro dp-euro-${euro.toLowerCase()}` : ''}">
          ${euro ? `<i class="dp-banner">${COMPETITION_NAMES[euro]}</i>` : ''}
          <div class="d-day-papers">${papersHtml}</div>
        </div>
      </div>
    `;

    panelEl.querySelectorAll('.d-day-papers img').forEach(img => {
      img.addEventListener('click', () => openCoverModal(img.dataset.full, img.alt));
    });

    if (window.innerWidth <= 760) {
      panelEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function draw() {
    eyebrowEl.textContent = paperFilter
      ? `CALENDÁRIO · ÉPOCA ${epoca} · LENTE: ${PAPER_NAMES[paperFilter].toUpperCase()}`
      : `CALENDÁRIO · ÉPOCA ${epoca} · 1 CLUBE POR DIA`;
    [...filterEl.children].forEach((btn, i) => {
      const ids = [null, ...Object.keys(PAPER_NAMES)];
      btn.classList.toggle('active', ids[i] === paperFilter);
    });
    legendEl.innerHTML = legendMarkup();
    panelEl.innerHTML = '<div class="d-day-hint">toca num dia →</div>';
    filterBarcodeRows(paperFilter);

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
        cell.dataset.date = day.date;
        if (paperFilter && !focusClub) {
          cell.className = 'cal-day no-data';
          cell.style.background = 'var(--d-panel2)';
          cell.dataset.tip = `${day.date} · sem votos de ${PAPER_NAMES[paperFilter]}`;
        } else {
          const { unanimous, hasMajority } = dayStats(day);
          cell.className = 'cal-day' + (unanimous ? ' unanimous' : hasMajority ? ' majority' : '');
          cell.style.background = (paperFilter || hasMajority) ? CLUB_META[focusClub].color : 'var(--d-yellow)';
          cell.dataset.tip = `${day.date} · ${(paperFilter || hasMajority) ? CLUB_META[focusClub].name : 'Inconclusivo'}`;
          const pulse = pulseFor(day, matchesByDate);
          if (pulse) cell.innerHTML = '<div class="pulse">🚨</div>';
        }
        cell.addEventListener('click', () => selectByDate(day.date));
        grid.appendChild(cell);
      });

      block.appendChild(grid);
      calEl.appendChild(block);
    });
  }

  // Shared by the calendar's own cell clicks and the barcode's onSelect
  // callback, so picking a day from either place puts both in sync.
  function selectByDate(date) {
    const day = days.find(d => d.date === date);
    if (!day) return;
    if (selectedCell) selectedCell.classList.remove('selected');
    const cell = calEl.querySelector(`.cal-day[data-date="${date}"]`);
    if (cell) { cell.classList.add('selected'); selectedCell = cell; }
    showDay(day);
    if (highlightBarcodeDay) highlightBarcodeDay(date);
  }

  draw();
  return selectByDate;
}

// Hover only (matches .cal-day's own @media (hover: hover) gate in the CSS \u2014
// no lingering tooltip from a touch tap's ghost mouseenter). Positioned in
// JS rather than as a CSS ::after like .cal-day's, because a stripe near
// .d-barcode's scrolled edge would otherwise get its tooltip clipped by that
// same overflow-x:auto instead of floating free.
const HOVER_CAPABLE = matchMedia('(hover: hover)').matches;
let bcTooltipEl = null;

function showBcTooltip(stripe) {
  if (!bcTooltipEl) {
    bcTooltipEl = document.createElement('div');
    bcTooltipEl.className = 'bc-tooltip hidden';
    document.body.appendChild(bcTooltipEl);
  }
  bcTooltipEl.textContent = stripe.dataset.tip;
  bcTooltipEl.classList.remove('hidden');

  const r = stripe.getBoundingClientRect();
  const margin = 8;
  const tw = bcTooltipEl.offsetWidth;
  const left = Math.max(margin, Math.min(r.left + r.width / 2 - tw / 2, innerWidth - tw - margin));
  bcTooltipEl.style.left = `${left}px`;
  bcTooltipEl.style.top = `${r.top - bcTooltipEl.offsetHeight - 8}px`;
}

function hideBcTooltip() {
  bcTooltipEl?.classList.add('hidden');
}

// One stripe per day per paper: a whole season of front pages in one glance.
// Fed by the same `days` the calendar builds, so it follows the epoca dropdown
// and needs no data of its own.
export function renderBarcode(days, onSelect) {
  const el = document.getElementById('barcode');
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  el.innerHTML = '';

  Object.keys(PAPER_NAMES).forEach(paper => {
    const row = document.createElement('div');
    row.className = 'd-barcode-row';
    row.dataset.paper = paper;
    row.innerHTML = `<span class="bc-label">${PAPER_NAMES[paper]}</span>`;

    const strip = document.createElement('div');
    strip.className = 'bc-strip';
    sorted.forEach(day => {
      const club = day.covers[paper];
      const stripe = document.createElement('i');
      stripe.className = 'bc-day';
      stripe.dataset.date = day.date;
      stripe.style.background = club ? CLUB_META[club].color : 'var(--d-panel2)';
      stripe.dataset.tip = `${day.date} \u00b7 ${club ? CLUB_META[club].name : 'sem capa'}`;
      stripe.addEventListener('click', () => onSelect(day.date));
      if (HOVER_CAPABLE) {
        stripe.addEventListener('mouseenter', () => showBcTooltip(stripe));
        stripe.addEventListener('mouseleave', hideBcTooltip);
      }
      strip.appendChild(stripe);
    });

    row.appendChild(strip);
    el.appendChild(row);
  });

  document.getElementById('barcode-range').textContent = sorted.length
    ? `${sorted[0].date} \u2192 ${sorted[sorted.length - 1].date} \u00b7 ${sorted.length} dias`
    : '';

  // Dragging the strip while a tooltip is open would leave it pointing at
  // wherever the stripe used to be \u2014 hide it instead of trying to track.
  // #barcode itself persists across \u00e9poca switches (only its children are
  // rebuilt above), so guard against re-wiring this on every renderBarcode.
  if (!el.dataset.tooltipWired) {
    el.addEventListener('scroll', hideBcTooltip, { passive: true });
    el.dataset.tooltipWired = '1';
  }

  return {
    // Lets the calendar mirror its selected day here, across all three rows.
    highlightDay(date) {
      el.querySelectorAll('.bc-day.selected').forEach(s => s.classList.remove('selected'));
      el.querySelectorAll(`.bc-day[data-date="${date}"]`).forEach(s => s.classList.add('selected'));
    },
    // Mirrors the calendar's own paper filter: null shows all three rows,
    // a paper id hides the other two instead of just dimming them, so the
    // barcode reads as "this paper's days" the same way the calendar's
    // "LENTE: X" mode does.
    filterPaper(paper) {
      el.querySelectorAll('.d-barcode-row').forEach(row => {
        row.classList.toggle('hidden', paper !== null && row.dataset.paper !== paper);
      });
    },
  };
}
