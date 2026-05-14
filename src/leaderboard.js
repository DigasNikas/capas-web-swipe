import { API_URL } from './state.js';
import { leaderboardModal, leaderboardList, modalOverlay } from './dom.js';
import { animateModalClose } from './modals.js';

export async function openLeaderboard() {
  leaderboardList.innerHTML = '<li class="lb-loading">A carregar…</li>';
  leaderboardModal.classList.remove('hidden');
  modalOverlay.classList.remove('hidden');

  try {
    const res  = await fetch(`${API_URL}/leaderboard`);
    const data = res.ok ? await res.json() : [];
    leaderboardList.innerHTML = '';
    const medals  = ['🥇', '🥈', '🥉'];
    const meEntry = data.find(e => e.is_me);
    const others  = data.filter(e => !e.is_me);

    others.forEach(({ user_email, swipes, rank }) => {
      const li = document.createElement('li');
      const rankClass = rank <= 3 ? ` lb-rank-${rank}` : '';
      li.className = `lb-row${rankClass}`;
      const rankLabel = medals[rank - 1] ?? `${rank}.`;
      const name = user_email.split('@')[0];
      li.innerHTML = `<span class="lb-rank">${rankLabel}</span><span class="lb-name">${name}</span><span class="lb-count">${swipes}</span>`;
      leaderboardList.appendChild(li);
    });

    if (meEntry) {
      if (others.length > 0) {
        const sep = document.createElement('li');
        sep.className = 'lb-sep';
        leaderboardList.appendChild(sep);
      }
      const li = document.createElement('li');
      const rankClass = meEntry.rank <= 3 ? ` lb-rank-${meEntry.rank}` : '';
      li.className = `lb-row lb-me${rankClass}`;
      const rankLabel = medals[meEntry.rank - 1] ?? `${meEntry.rank}.`;
      const name = meEntry.user_email.split('@')[0];
      li.innerHTML = `<span class="lb-rank">${rankLabel}</span><span class="lb-name">${name} <span class="lb-you">tu</span></span><span class="lb-count">${meEntry.swipes}</span>`;
      leaderboardList.appendChild(li);
    }

    if (data.length === 0) leaderboardList.innerHTML = '<li class="lb-loading">Sem votos ainda.</li>';
  } catch {
    leaderboardList.innerHTML = '<li class="lb-loading">Erro ao carregar.</li>';
  }
}

export function closeLeaderboard() {
  animateModalClose(leaderboardModal, () => {
    leaderboardModal.classList.add('hidden');
    modalOverlay.classList.add('hidden');
  });
}
