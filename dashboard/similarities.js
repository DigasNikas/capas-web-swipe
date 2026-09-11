import { CLUB_SHORT, PAPER_NAMES } from '/src/domain.js';

const CLUB_COLOR = { sporting: 'var(--sporting)', porto: 'var(--porto)', benfica: 'var(--benfica)', others: 'var(--others)' };

const status = document.getElementById('status');
const groupsEl = document.getElementById('groups');

// Everything /api/similarities returned, kept so the filter is a re-render
// rather than a re-fetch: the channel is already on every match.
let allGroups = [];
let via = 'headline';

document.querySelectorAll('.channels button').forEach(btn => {
  btn.addEventListener('click', () => {
    via = btn.dataset.via;
    document.querySelectorAll('.channels button').forEach(b => b.classList.toggle('on', b === btn));
    render(allGroups);
  });
});

load();

async function load() {
  status.textContent = 'A carregar…';
  status.classList.remove('error');
  groupsEl.innerHTML = '';

  let res;
  try {
    res = await fetch('/api/similarities');
  } catch (err) {
    status.textContent = `Erro de rede: ${err}`;
    status.classList.add('error');
    return;
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error ?? ''; } catch { /* not JSON, no extra detail */ }
    status.textContent = `Erro ${res.status}${detail ? `: ${detail}` : '.'}`;
    status.classList.add('error');
    return;
  }

  allGroups = await res.json();
  render(allGroups);
}

function coverBlock(c, { showAi }) {
  const div = document.createElement('div');
  const club = showAi ? c.ai_club : (c.club ?? c.ai_club);
  const img = document.createElement('img');
  img.src = c.thumb_url || c.url;
  img.alt = PAPER_NAMES[c.newspaper] || c.newspaper;
  img.loading = 'lazy';
  div.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'cover-meta';
  const d = new Date(c.date + 'T00:00:00');
  meta.textContent = `${PAPER_NAMES[c.newspaper] || c.newspaper} · ${d.toLocaleDateString('pt-PT')}`;
  div.appendChild(meta);

  if (club) {
    const tag = document.createElement('span');
    tag.className = 'club-tag';
    tag.style.background = CLUB_COLOR[club] || 'var(--muted)';
    tag.textContent = (showAi ? 'AI ' : '') + (CLUB_SHORT[club] || club);
    div.appendChild(tag);
  }

  return div;
}

// A cover whose matches all came from the other channel drops out entirely
// rather than rendering an empty row — the point of the filter is to see what
// one channel found, and a wall of covers with nothing under them is noise.
function render(groups) {
  const shown = groups
    .map(g => ({ ...g, ragCovers: g.ragCovers.filter(c => (c.via ?? 'layout') === via) }))
    .filter(g => g.ragCovers.length > 0);

  const matches = shown.reduce((n, g) => n + g.ragCovers.length, 0);
  status.textContent =
    `${shown.length} capas, ${matches} correspondências ${via === 'headline' ? 'por texto' : 'por imagem'}.`;
  status.classList.remove('error');
  return renderGroups(shown);
}

function renderGroups(groups) {
  // Clear first: this used to run once per page load, straight after load()
  // emptied the list itself. Switching channels calls it again, and without
  // this the new rows stacked under the old ones.
  groupsEl.innerHTML = '';

  if (groups.length === 0) {
    groupsEl.innerHTML =
      `<div class="empty">Nenhuma correspondência ${via === 'headline' ? 'por texto' : 'por imagem'}.</div>`;
    return;
  }

  groups.forEach(g => {
    const row = document.createElement('div');
    row.className = 'group';

    const main = coverBlock(g, { showAi: true });
    main.className = 'main-cover';
    if (g.ai_headline) {
      const headline = document.createElement('div');
      headline.className = 'headline';
      headline.textContent = `"${g.ai_headline.replace(/^["']+|["']+$/g, '')}"`;
      main.appendChild(headline);
    }
    row.appendChild(main);

    const refs = document.createElement('div');
    refs.className = 'refs';
    g.ragCovers.forEach(rc => {
      const block = coverBlock(rc, { showAi: false });
      block.className = 'ref-cover';
      refs.appendChild(block);
    });
    row.appendChild(refs);

    groupsEl.appendChild(row);
  });
}
