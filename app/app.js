import { state, API_URL, ACTIVE_DATE_KEY, DECISION_TO_ACTION } from '/src/state.js';
import {
  loadingState, comecarPill, activeCardArea, swipeHints,
  leaderboardModal, instrucoesModal, accountModal, modalOverlay,
  coverModal, definicoesModal, userDetailPanel,
} from '/src/dom.js';
import { groupByDate } from '/src/dates.js';
import { syncCalToActiveDate, setDateClickHandler, prevMonth, nextMonth } from '/src/calendar.js';
import {
  renderStack, advanceToNextPendingGroup, deactivateSwipeMode, activateSwipeMode,
  triggerAction, goToCalendarDate, clearSwipeFeedback, hidePill,
  goToNextPendingDay, goToToday,
} from '/src/cards.js';
import { updateProgress } from '/src/ui.js';
import { openInstrucoes, closeInstrucoes, addSwipeDownToClose, closeCoverModal } from '/src/modals.js';
import { openLeaderboard, closeLeaderboard, closeUserDetail } from '/src/leaderboard.js';
import { openAccount, closeAccount } from '/src/account.js';
import { openDefinicoes, closeDefinicoes, handleSettingChange, applyTheme } from '/src/settings.js';

applyTheme();

// Wire calendar date click → navigate card stack
setDateClickHandler(goToCalendarDate);

// Wire swipe-down-to-close for all modals
addSwipeDownToClose(instrucoesModal,   closeInstrucoes);
addSwipeDownToClose(leaderboardModal,  closeLeaderboard);
addSwipeDownToClose(accountModal,      closeAccount);
addSwipeDownToClose(definicoesModal,   closeDefinicoes);

// ── Event Listeners ────────────────────────────────────────────────────────
comecarPill.addEventListener('click', () => {
  if (state.presentationMode && state.queue.length > 0) activateSwipeMode(state.queue[0]);
});

activeCardArea.addEventListener('click', e => {
  if (!e.target.closest('.card')) deactivateSwipeMode();
});

document.getElementById('btn-calendar-back').addEventListener('click', deactivateSwipeMode);

document.querySelectorAll('.vote-bar-btn').forEach(btn =>
  btn.addEventListener('click', () => triggerAction(btn.dataset.dir))
);

document.getElementById('btn-instrucoes').addEventListener('click', openInstrucoes);
instrucoesModal.addEventListener('click', e => { if (e.target === instrucoesModal) closeInstrucoes(); });

document.getElementById('btn-leaderboard').addEventListener('click', openLeaderboard);
leaderboardModal.addEventListener('click', e => { if (e.target === leaderboardModal) closeLeaderboard(); });

document.getElementById('btn-conta').addEventListener('click', openAccount);
accountModal.addEventListener('click', e => { if (e.target === accountModal) closeAccount(); });

document.getElementById('btn-definicoes').addEventListener('click', openDefinicoes);
definicoesModal.addEventListener('click', e => { if (e.target === definicoesModal) closeDefinicoes(); });
definicoesModal.querySelectorAll('.switch').forEach(input =>
  input.addEventListener('change', () => handleSettingChange(input))
);

coverModal.addEventListener('click', closeCoverModal);
document.getElementById('cover-modal-close').addEventListener('click', closeCoverModal);

modalOverlay.addEventListener('click', () => {
  if (!leaderboardModal.classList.contains('hidden')) closeLeaderboard();
  if (!instrucoesModal.classList.contains('hidden'))  closeInstrucoes();
  if (!accountModal.classList.contains('hidden'))     closeAccount();
  if (!definicoesModal.classList.contains('hidden'))  closeDefinicoes();
});

document.getElementById('btn-reset').addEventListener('click', () => {
  const first = state.dateGroups[0];
  if (!first) return;
  state.groupIndex       = 0;
  state.queue            = [...first.ids];
  state.presentationMode = true;
  localStorage.setItem(ACTIVE_DATE_KEY, first.date);
  activeCardArea.classList.add('hidden');
  activeCardArea.innerHTML = '';
  swipeHints.classList.add('hidden');
  clearSwipeFeedback();
  hidePill();
  syncCalToActiveDate();
  renderStack();
  updateProgress();
});

// Whichever modal is on top, if any — cover-modal sits above the bottom
// sheets (z-index 200 vs 60), so it takes priority when both are open.
// user-detail-panel (70) is checked before leaderboardModal (60) for the
// same reason: it can be open while Classificação still is, underneath it.
function openModal() {
  if (!coverModal.classList.contains('hidden'))      return { close: closeCoverModal };
  if (!accountModal.classList.contains('hidden'))     return { close: closeAccount };
  if (!definicoesModal.classList.contains('hidden'))  return { close: closeDefinicoes };
  if (!userDetailPanel.classList.contains('hidden'))  return { close: closeUserDetail };
  if (!leaderboardModal.classList.contains('hidden')) return { close: closeLeaderboard };
  if (!instrucoesModal.classList.contains('hidden'))  return { close: closeInstrucoes };
  return null;
}

document.addEventListener('keydown', e => {
  const modal = openModal();

  if (e.key === 'Escape') {
    if (modal) { modal.close(); return; }
    if (!state.presentationMode) deactivateSwipeMode();
    return;
  }

  // Don't let space/arrows reach the calendar or the voting card while a
  // modal is open on top of it.
  if (modal) return;

  if (!state.settings.voteKeyboard) return;

  if (e.key === ' ' && state.presentationMode && state.queue.length > 0) {
    e.preventDefault(); // stop it from also activating whatever button has focus
    activateSwipeMode(state.queue[0]);
    return;
  }

  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (map[e.key]) triggerAction(map[e.key]);
});

document.getElementById('cal-prev').addEventListener('click', prevMonth);
document.getElementById('cal-next').addEventListener('click', nextMonth);
document.getElementById('cal-jump-next').addEventListener('click', goToNextPendingDay);
document.getElementById('cal-jump-today').addEventListener('click', goToToday);

// ── Cross-device sync ─────────────────────────────────────────────────────
let lastActivityAt = Date.now();
['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(event =>
  document.addEventListener(event, () => lastActivityAt = Date.now(), { passive: true })
);

async function syncIfStale() {
  try {
    const res = await fetch(`${API_URL}/swipes`);
    if (!res.ok) return;
    const swipes = await res.json();
    if (swipes.length !== state.catalogue.length) location.reload();
  } catch {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncIfStale();
});

setInterval(() => {
  if (Date.now() - lastActivityAt > 10 * 60 * 1000) syncIfStale();
}, 60_000);

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  loadingState.classList.remove('hidden');

  let covers;
  try {
    const res = await fetch(`${API_URL}/covers`);
    covers = await res.json();
  } catch {
    loadingState.querySelector('p').textContent = 'Failed to load images.';
    return;
  }

  state.images = covers.map(c => ({
    id:        String(c.id),
    name:      c.newspaper,
    src:       c.url,
    thumb:     c.thumb_url,
    newspaper: c.newspaper,
    date:      c.date,
  }));

  state.dateGroups = groupByDate(state.images);

  let serverSwipes = [];
  try {
    const res = await fetch(`${API_URL}/swipes`);
    if (res.ok) serverSwipes = await res.json();
  } catch {}

  state.catalogue = serverSwipes
    .map(s => {
      const img    = state.images.find(i => i.id === String(s.cover_id));
      const action = DECISION_TO_ACTION[s.decision];
      if (!img || !action) return null;
      // Catalogue/account grids only ever show these at thumbnail size —
      // use the thumbnail here, keep the swipe card itself (state.images[].src) full-res.
      // `full` keeps the original URL around for the fullscreen cover viewer.
      return { ...img, src: img.thumb, full: img.src, action, starred: !!s.is_favorite, timestamp: s.swiped_at };
    })
    .filter(Boolean);

  state.groupIndex = 0;
  advanceToNextPendingGroup();

  // advanceToNextPendingGroup already lands on the newest pending day —
  // today's, the moment a fresh cover shows up unswiped, since dateGroups
  // sorts newest-first. Only fall back to resuming wherever localStorage
  // last left off when that's *not* the case: today already fully
  // swiped, or not scraped yet. Otherwise a stale saved date from an
  // unfinished older day would win here and bury today's fresh cover.
  const todayStr     = new Date().toISOString().slice(0, 10);
  const landedOnToday = state.dateGroups[state.groupIndex]?.date === todayStr;

  if (!landedOnToday) {
    const savedDate = localStorage.getItem(ACTIVE_DATE_KEY);
    if (savedDate) {
      const idx = state.dateGroups.findIndex(g => g.date === savedDate);
      if (idx !== -1) {
        const sIds    = new Set(state.catalogue.map(e => e.id));
        const pending = state.dateGroups[idx].ids.filter(id => !sIds.has(id));
        if (pending.length > 0) { state.groupIndex = idx; state.queue = pending; }
      }
    }
  }

  syncCalToActiveDate();
  loadingState.classList.add('hidden');
  renderStack();
  updateProgress();
}

init();
