// The crowd's and the model's verdict cards, and the AI diff browser.
import { PAPER_NAMES } from '/src/domain.js';
import { CLUB_META, MONTHS } from '/src/common.js';
import { openAiDiffModal, openCoverModal } from '/src/cover-modal.js';

// Shared by both verdict cards: unhide the section, fit the title, stamp the
// input date. What each card shows below that differs — see renderVerdict
// and renderAi.
function renderVerdictHeader(id, date) {
  document.getElementById(id).classList.remove('hidden');
  fitTextToContainer(document.getElementById(`${id}-title`), 2.6, 1);
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById(`${id}-date`).textContent = `INPUT · ${dateLabel.toUpperCase()}`;
}

// The crowd's verdict card ("Hoje é dia de quem?") — covers, one rolled-up
// winner, a confidence bar.
export function renderVerdict(id, data, unit) {
  if (!data) return;
  renderVerdictHeader(id, data.date);
  renderVerdictCovers(document.getElementById(`${id}-covers`), data.covers);

  const winnerEl = document.getElementById(`${id}-winner`);
  const winnerColor = data.hasMajority ? CLUB_META[data.winner].color : 'var(--d-yellow)';
  winnerEl.textContent = data.hasMajority ? CLUB_META[data.winner].name : 'Empate técnico';
  winnerEl.style.color = winnerColor;
  fitTextToContainer(winnerEl, 4.5, 1);

  const pct = Math.round(data.confidence * 100);
  document.getElementById(`${id}-conf-fill`).style.width = `${pct}%`;
  document.getElementById(`${id}-conf-fill`).style.background = winnerColor;
  document.getElementById(`${id}-conf-label`).textContent = `${pct}% ${unit}`;
}

// The model's card ("E a máquina, que diz?") — the covers already showed
// above in "Hoje é dia de quem?", so this one skips straight to what the
// model called each paper, and the headline it read to get there.
export function renderAi(latestAi, latest, rows) {
  if (!latestAi) return;
  renderVerdictHeader('ai', latestAi.date);

  const pct = Math.round(latestAi.agreement * 100);
  document.getElementById('ai-agreement').textContent =
    `Concorda com a comunidade em ${pct}% das ${latestAi.labelled} capas já analisadas.`;

  const papersEl = document.getElementById('ai-papers');
  papersEl.innerHTML = '';
  latestAi.covers.forEach(c => papersEl.appendChild(aiPaperRow(c)));

  const same = latest && latest.winner === latestAi.winner;
  const verdictEl = document.getElementById('ai-vs-human');
  verdictEl.textContent = same ? 'HOJE · CONCORDA COM A COMUNIDADE' : 'HOJE · DISCORDA DA COMUNIDADE';
  verdictEl.classList.toggle('disagrees', !same);

  renderAiDiffs(rows);
}

// textContent throughout — c.headline and c.why are copied verbatim off a
// newspaper page by the model, not text this codebase controls, so they get
// the same treatment as a comment a stranger wrote.
function aiPaperRow(c) {
  const row = document.createElement('div');
  row.className = 'd-ai-paper';

  const name = document.createElement('span');
  name.className = 'd-ai-paper-name';
  name.textContent = c.name;

  const club = document.createElement('span');
  club.className = 'd-ai-paper-club';
  club.style.color = CLUB_META[c.club].color;
  club.textContent = CLUB_META[c.club].name;

  row.append(name, club);

  if (c.headline) {
    const headline = document.createElement('span');
    headline.className = 'd-ai-paper-headline';
    // Some headlines are themselves a quote ("É sempre o mesmo
    // beneficiário") and the model copies the page's own quote marks —
    // strip those before adding ours, or they double up.
    headline.textContent = `"${c.headline.replace(/^["']+|["']+$/g, '')}"`;
    row.append(headline);
  }

  // Older covers were classified before the prompt asked for this, so it's
  // absent for most of the archive until the backfill catches up.
  if (c.why) {
    const why = document.createElement('span');
    why.className = 'd-ai-paper-why';
    why.textContent = `→ ${c.why}`;
    row.append(why);
  }

  return row;
}

// The other 13%: every cover the model and the crowd read differently. Same
// navigation as the app's Histórico — pick a month, then see its covers —
// because the full list is a few hundred cards and nobody scrolls that.
// No extra request: /api/stats already returns both labels per cover for the
// calendar, so this is a filter over rows already in memory.
function renderAiDiffs(rows) {
  const diffs = rows.filter(r => r.ai_club && r.ai_club !== r.club).reverse();
  if (diffs.length === 0) return;

  const btn = document.getElementById('btn-ai-diffs');
  const panel = document.getElementById('ai-diffs');
  const months = groupDiffsByMonth(diffs);
  let openMonth = null;

  const draw = () => {
    if (!openMonth) {
      panel.innerHTML = `<div class="d-ai-months">${months.map(aiMonthCard).join('')}</div>`;
      return;
    }
    const m = months.find(x => x.key === openMonth);
    panel.innerHTML = `
      <button class="d-ai-back" type="button">← ${m.label} · ${m.items.length} capas</button>
      <div class="d-ai-grid">${m.items.map((r, i) => aiDiffCard(r, i)).join('')}</div>`;
  };

  const label = () => panel.classList.contains('hidden')
    ? `Onde discordam · ${diffs.length} capas →`
    : 'Esconder ↑';

  btn.classList.remove('hidden');
  btn.textContent = label();

  btn.addEventListener('click', () => {
    if (panel.childElementCount === 0) draw();
    panel.classList.toggle('hidden');
    btn.textContent = label();
  });

  // One listener for the whole panel — it can hold a few hundred covers.
  panel.addEventListener('click', e => {
    if (e.target.closest('.d-ai-back')) { openMonth = null; draw(); return; }
    const month = e.target.closest('.d-ai-month');
    if (month) { openMonth = month.dataset.key; draw(); return; }
    // The whole card is the target, caption included — half a card that opens
    // the cover and half that does nothing is just a broken-feeling card.
    const card = e.target.closest('.d-ai-diff');
    if (card) openAiDiffModal(months.find(x => x.key === openMonth).items, Number(card.dataset.index));
  });
}

function groupDiffsByMonth(diffs) {
  const map = new Map();
  for (const r of diffs) {
    const key = r.date.slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    label: new Date(key + '-01T00:00:00')
      .toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' }),
    items,
  }));
}

// The fanned three-cover stack from Histórico's month picker.
function aiMonthCard({ key, label, items }) {
  const stack = items.slice(0, 3)
    .map((r, i) => `<span class="d-ai-bc bc-${i}"><img src="${r.thumb_url}" alt="" loading="lazy" /></span>`)
    .join('');
  return `
    <button class="d-ai-month" type="button" data-key="${key}">
      <span class="d-ai-stack">${stack}<span class="d-ai-count">${items.length}</span></span>
      <span class="d-ai-mlabel">${label}</span>
    </button>`;
}

// Same shape as the app's Histórico grid: small portrait card, caption laid
// over the cover. The two verdicts are colour blocks rather than text so the
// disagreement is readable at thumbnail size — club colour carries it, the
// SCP/SLB/FCP code is just the confirmation.
function aiDiffCard(r, i) {
  const d = new Date(r.date + 'T00:00:00');
  const paper = PAPER_NAMES[r.newspaper];
  const side = (tag, k) =>
    `<span class="ad-v" style="background:${CLUB_META[k].color}"><i>${tag}</i>${CLUB_META[k].short}</span>`;
  return `
    <figure class="d-ai-diff" data-index="${i}">
      <img src="${r.thumb_url}" alt="${paper}" loading="lazy" />
      <figcaption>
        <div class="ad-date">${paper} · ${d.getDate()} ${MONTHS[d.getMonth()]}</div>
        <div class="ad-vs">${side('AI', r.ai_club)}${side('VOTO', r.club)}</div>
      </figcaption>
    </figure>`;
}

// Shrinks font-size until the (single-line) text fits its container —
// club names range from "Porto" to "Empate técnico", too wide a spread
// for one fixed clamp() to keep on one line at every length.
function renderVerdictCovers(coversEl, covers) {
  coversEl.innerHTML = '';
  covers.forEach(c => {
    const div = document.createElement('div');
    div.innerHTML = `
      <img src="${c.thumb_url}" alt="${c.name}" loading="lazy" />
      <div class="lc-name">${c.name}</div>
      <div class="lc-club" style="color:${CLUB_META[c.club].color}">${CLUB_META[c.club].name}</div>
    `;
    div.querySelector('img').addEventListener('click', () => openCoverModal(c.url, c.name));
    coversEl.appendChild(div);
  });
}

function fitTextToContainer(el, maxRem = 4.5, minRem = 1.6) {
  const shrink = () => {
    let size = maxRem;
    el.style.fontSize = `${size}rem`;
    while (el.scrollWidth > el.clientWidth && size > minRem) {
      size -= 0.15;
      el.style.fontSize = `${size}rem`;
    }
  };
  shrink();
  // Inter Tight is a Google Fonts webfont. If it's still loading the first
  // time shrink() runs, scrollWidth is measured against the fallback font's
  // (usually narrower) metrics — the loop can exit early "fitting" a size
  // that overflows once the real, wider font swaps in a moment later with
  // no re-check. Re-run once every font on the page has actually loaded.
  document.fonts?.ready.then(shrink);
}
