import { API_URL } from './state.js';
import { leaderboardModal, leaderboardList, leaderboardMe, modalOverlay } from './dom.js';
import { animateModalClose } from './modals.js';

const MEDAL_COLORS = { 1: '#f5b042', 2: '#cbd5e1', 3: '#d97706' };

function medalSvg(rank) {
  return `<svg class="lb-medal" viewBox="0 0 24 24" width="18" height="18">
    <circle cx="12" cy="12" r="10" fill="${MEDAL_COLORS[rank]}"/>
    <text x="12" y="16.5" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" fill="#0a0a0f">${rank}</text>
  </svg>`;
}

function rowHtml({ user_email, swipes, rank }, isMe) {
  const rankClass = rank <= 3 ? ` lb-rank-${rank}` : '';
  const rankLabel = rank <= 3 ? medalSvg(rank) : `${rank}.`;
  const name = user_email.split('@')[0];
  const you = isMe ? ' <span class="lb-you">tu</span>' : '';
  return `<span class="lb-rank">${rankLabel}</span><span class="lb-name">${name}${you}</span><span class="lb-count">${swipes}</span>`;
}

export async function openLeaderboard() {
  leaderboardList.innerHTML = '<li class="lb-loading">A carregar…</li>';
  leaderboardMe.innerHTML = '';
  leaderboardModal.classList.remove('hidden');
  modalOverlay.classList.remove('hidden');

  try {
    const res  = await fetch(`${API_URL}/leaderboard`);
    const data = res.ok ? await res.json() : [];
    leaderboardList.innerHTML = '';

    // "Me" stays in natural rank position in the scrollable list (so
    // neighbors give context), but the list can be long enough that
    // finding yourself needs scrolling — so it's *also* pinned above
    // the list, always visible regardless of scroll position or rank.
    const meEntry = data.find(e => e.is_me);
    if (meEntry) {
      const pinned = document.createElement('div');
      pinned.className = 'lb-row lb-me lb-pinned-row';
      pinned.innerHTML = rowHtml(meEntry, true);
      leaderboardMe.appendChild(pinned);
    }

    data.forEach(entry => {
      const li = document.createElement('li');
      li.className = `lb-row${entry.rank <= 3 ? ` lb-rank-${entry.rank}` : ''}${entry.is_me ? ' lb-me' : ''}`;
      li.innerHTML = rowHtml(entry, entry.is_me);
      leaderboardList.appendChild(li);
    });

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
