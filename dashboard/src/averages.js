import { CLUB_IDS, PAPER_NAMES } from '/src/domain.js';
import { CLUB_META } from '/src/common.js';
import { openCoverModal } from '/src/cover-modal.js';

// The averages are generated offline by scripts/avg_cover.py and committed
// under dashboard/avg/, so this is a plain static fetch with no endpoint behind
// it. Both sections stay hidden if the files aren't there.
export async function renderAvgCovers() {
  let counts;
  try {
    counts = await (await fetch('/avg/counts.json')).json();
  } catch {
    return;
  }

  const papers = Object.keys(PAPER_NAMES).filter(p => counts[p]);
  if (!papers.length) return;

  const card = (key, label) => `
    <figure class="d-avg-card">
      <img src="/avg/${key}.jpg" alt="Capa m\u00e9dia \u2014 ${label}" loading="lazy" />
      <figcaption>${label}<span>m\u00e9dia de ${counts[key]} capas</span></figcaption>
    </figure>`;

  const gridEl = document.getElementById('avg-papers');
  const filterEl = document.getElementById('avg-club-filter');

  // null = "Todos" (the plain per-paper mean); a club key switches all three
  // papers to that club's mean at once, so the three cards stay comparable.
  function draw(club) {
    gridEl.innerHTML = papers
      .filter(p => !club || counts[`${p}-${club}`])
      .map(p => card(club ? `${p}-${club}` : p, PAPER_NAMES[p]))
      .join('');
    [...filterEl.children].forEach(b => b.classList.toggle('active', b.dataset.club === (club || 'todos')));
  }

  filterEl.innerHTML = [{ id: 'todos', name: 'Todos' }, ...CLUB_IDS.map(c => ({ id: c, name: CLUB_META[c].name }))]
    .map(c => `<button data-club="${c.id}">${c.name}</button>`).join('');
  filterEl.addEventListener('click', e => {
    if (!e.target.dataset.club) return;
    draw(e.target.dataset.club === 'todos' ? null : e.target.dataset.club);
  });
  draw(null);
  document.getElementById('media').classList.remove('hidden');

  // Detail is the whole point of these and the grid renders them small.
  gridEl.addEventListener('click', e => {
    if (e.target.tagName === 'IMG') openCoverModal(e.target.src, e.target.alt);
  });
}
