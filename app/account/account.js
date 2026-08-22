import { API_URL, DECISION_TO_ACTION } from '/src/state.js';
import { renderCatalogue, setActiveFilter, catalogueBack } from '/src/catalogue.js';

const ACTION_LABELS = { keep: 'Sporting', reject: 'Benfica', skip: 'Porto', favorite: 'Restantes' };
const ACTION_COLORS = { keep: 'var(--keep)', reject: 'var(--reject)', skip: 'var(--skip)', favorite: 'var(--favorite)' };

document.querySelectorAll('.filter-btn').forEach(btn =>
  btn.addEventListener('click', () => setActiveFilter(btn.dataset.filter))
);
document.getElementById('btn-catalogue-back').addEventListener('click', catalogueBack);

async function init() {
  const [coversRes, swipesRes, leaderboardRes] = await Promise.all([
    fetch(`${API_URL}/covers`),
    fetch(`${API_URL}/swipes`),
    fetch(`${API_URL}/leaderboard`),
  ]);

  const covers = coversRes.ok ? await coversRes.json() : [];
  const swipes = swipesRes.ok ? await swipesRes.json() : [];
  const leaderboard = leaderboardRes.ok ? await leaderboardRes.json() : [];

  const catalogue = swipes
    .map(s => {
      const cover  = covers.find(c => String(c.id) === String(s.cover_id));
      const action = DECISION_TO_ACTION[s.decision];
      if (!cover || !action) return null;
      return { id: String(cover.id), name: cover.newspaper, src: cover.thumb_url, date: cover.date, action, timestamp: s.swiped_at };
    })
    .filter(Boolean);

  document.getElementById('acc-total').textContent = catalogue.length;
  document.getElementById('acc-pending').textContent = Math.max(0, covers.length - catalogue.length);

  const me = leaderboard.find(e => e.is_me);
  document.getElementById('acc-rank').textContent = me ? `#${me.rank}` : '–';

  const breakdown = document.getElementById('acc-breakdown');
  Object.keys(ACTION_LABELS).forEach(action => {
    const count = catalogue.filter(e => e.action === action).length;
    const pct   = catalogue.length ? Math.round((count / catalogue.length) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'acc-bar-row';
    row.innerHTML = `
      <span>${ACTION_LABELS[action]}</span>
      <span class="acc-bar-track"><span class="acc-bar-fill" style="width:${pct}%;background:${ACTION_COLORS[action]}"></span></span>
      <span>${count}</span>
    `;
    breakdown.appendChild(row);
  });

  renderCatalogue(catalogue);
}

init();
