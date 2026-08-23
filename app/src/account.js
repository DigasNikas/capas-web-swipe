import { state, API_URL } from './state.js';
import { accountModal, modalOverlay, accTotal, accRank, accPending, accBreakdown } from './dom.js';
import { animateModalClose } from './modals.js';
import { renderCatalogue, setActiveFilter, catalogueBack } from './catalogue.js';

const ACTION_LABELS = { keep: 'Sporting', reject: 'Benfica', skip: 'Porto', favorite: 'Restantes' };
const ACTION_COLORS = { keep: 'var(--keep)', reject: 'var(--reject)', skip: 'var(--skip)', favorite: 'var(--favorite)' };

document.querySelectorAll('.filter-btn').forEach(btn =>
  btn.addEventListener('click', () => setActiveFilter(btn.dataset.filter))
);
document.getElementById('btn-catalogue-back').addEventListener('click', catalogueBack);

export async function openAccount() {
  accountModal.classList.remove('hidden');
  modalOverlay.classList.remove('hidden');

  // state.images/state.catalogue are already loaded by app.js's init() —
  // no need to refetch covers/swipes like the old standalone account page did.
  const catalogue = state.catalogue;
  accTotal.textContent   = catalogue.length;
  accPending.textContent = Math.max(0, state.images.length - catalogue.length);

  accRank.textContent = '–';
  try {
    const res = await fetch(`${API_URL}/leaderboard`);
    const data = res.ok ? await res.json() : [];
    const me = data.find(e => e.is_me);
    accRank.textContent = me ? `#${me.rank}` : '–';
  } catch {}

  accBreakdown.innerHTML = '';
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
    accBreakdown.appendChild(row);
  });

  renderCatalogue(catalogue);
}

export function closeAccount() {
  animateModalClose(accountModal, () => {
    accountModal.classList.add('hidden');
    modalOverlay.classList.add('hidden');
  });
}
