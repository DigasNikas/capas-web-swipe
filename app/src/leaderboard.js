import { API_URL, ACTIONS } from './state.js';
import {
  leaderboardModal, leaderboardList, leaderboardMe, modalOverlay,
  userDetailPanel, btnLbBack, lbDetailName, lbCurrentStreak, lbBestStreak, lbDetailBreakdown,
} from './dom.js';
import { animateModalClose } from './modals.js';

const MEDAL_COLORS = { 1: '#f5b042', 2: '#cbd5e1', 3: '#d97706' };

// decision -> {label, color}, derived from ACTIONS (state.js) rather than a
// second hand-written map — action.name (keep/reject/skip/favorite) is
// exactly the CSS custom property name too (--keep/--reject/--skip/--favorite).
const CLUB_META = Object.fromEntries(
  Object.values(ACTIONS).map(a => [a.decision, { label: a.label, color: `var(--${a.name})` }])
);

function medalSvg(rank) {
  return `<svg class="lb-medal" viewBox="0 0 24 24" width="18" height="18">
    <circle cx="12" cy="12" r="10" fill="${MEDAL_COLORS[rank]}"/>
    <text x="12" y="16.5" text-anchor="middle" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="700" fill="#0a0a0f">${rank}</text>
  </svg>`;
}

function rowHtml({ user_email, swipes, rank }, isMe) {
  const rankLabel = rank <= 3 ? medalSvg(rank) : `${rank}.`;
  const name = user_email.split('@')[0];
  const you = isMe ? ' <span class="lb-you">tu</span>' : '';
  return `<span class="lb-rank">${rankLabel}</span><span class="lb-name">${name}${you}</span><span class="lb-count">${swipes}</span>`;
}

// Same tap/keyboard pattern as the app calendar's cells (calendar.js) — role
// + tabIndex + Enter/Space, not just a click listener.
function makeRowClickable(el, email) {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `Ver estatísticas de ${email.split('@')[0]}`);
  el.addEventListener('click', () => openUserDetail(email));
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUserDetail(email); }
  });
}

export async function openLeaderboard() {
  closeUserDetail();
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
      makeRowClickable(pinned, meEntry.user_email);
      leaderboardMe.appendChild(pinned);
    }

    data.forEach(entry => {
      const li = document.createElement('li');
      li.className = `lb-row${entry.rank <= 3 ? ` lb-rank-${entry.rank}` : ''}${entry.is_me ? ' lb-me' : ''}`;
      li.innerHTML = rowHtml(entry, entry.is_me);
      makeRowClickable(li, entry.user_email);
      leaderboardList.appendChild(li);
    });

    if (data.length === 0) leaderboardList.innerHTML = '<li class="lb-loading">Sem votos ainda.</li>';
  } catch {
    leaderboardList.innerHTML = '<li class="lb-loading">Erro ao carregar.</li>';
  }
}

async function openUserDetail(email) {
  userDetailPanel.classList.remove('hidden');

  lbDetailName.textContent = email.split('@')[0];
  lbCurrentStreak.textContent = '–';
  lbBestStreak.textContent = '–';
  lbDetailBreakdown.innerHTML = '<p class="lb-loading">A carregar…</p>';

  try {
    const res = await fetch(`${API_URL}/user-stats?email=${encodeURIComponent(email)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();

    lbCurrentStreak.textContent = data.current_streak;
    lbBestStreak.textContent = data.best_streak;

    const total = Object.values(data.breakdown).reduce((a, b) => a + b, 0);
    lbDetailBreakdown.innerHTML = '';
    Object.keys(CLUB_META).forEach(decision => {
      const { label, color } = CLUB_META[decision];
      const count = data.breakdown[decision] ?? 0;
      const pct   = total ? Math.round((count / total) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'acc-bar-row';
      row.innerHTML = `
        <span>${label}</span>
        <span class="acc-bar-track"><span class="acc-bar-fill" style="width:${pct}%;background:${color}"></span></span>
        <span>${count}</span>
      `;
      lbDetailBreakdown.appendChild(row);
    });
  } catch {
    lbDetailBreakdown.innerHTML = '<p class="lb-loading">Erro ao carregar.</p>';
  }
}

// Mirrors animateModalClose's timing/easing but for the drawer's own
// horizontal slide — not worth generalizing that helper for one caller.
export function closeUserDetail() {
  if (userDetailPanel.classList.contains('hidden')) return;
  const content = userDetailPanel.querySelector('.udp-content');
  content.style.animation = 'drawer-out-left 0.28s cubic-bezier(0.32, 0.72, 0, 1) forwards';
  setTimeout(() => {
    content.style.animation = '';
    userDetailPanel.classList.add('hidden');
  }, 280);
}

btnLbBack.addEventListener('click', closeUserDetail);

// Own backdrop click-to-close, same as #cover-detail-panel — guarded to
// the panel itself so a click on the back button or a breakdown row
// doesn't also close it (they're descendants, so they'd otherwise bubble
// up here too).
userDetailPanel.addEventListener('click', e => {
  if (e.target === userDetailPanel) closeUserDetail();
});

export function closeLeaderboard() {
  animateModalClose(leaderboardModal, () => {
    leaderboardModal.classList.add('hidden');
    modalOverlay.classList.add('hidden');
  });
}
