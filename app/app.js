import { state, API_URL, ACTIVE_DATE_KEY, DECISION_TO_ACTION } from '/src/state.js';
import {
  loadingState, comecarPill, activeCardArea, swipeHints,
  leaderboardModal, instrucoesModal, modalOverlay,
} from '/src/dom.js';
import { groupByDate } from '/src/dates.js';
import { syncCalToActiveDate, setDateClickHandler, prevMonth, nextMonth } from '/src/calendar.js';
import {
  renderStack, advanceToNextPendingGroup, deactivateSwipeMode, activateSwipeMode,
  triggerAction, goToCalendarDate, clearSwipeFeedback, hidePill,
} from '/src/cards.js';
import { updateProgress } from '/src/ui.js';
import { openInstrucoes, closeInstrucoes, addSwipeDownToClose } from '/src/modals.js';
import { openLeaderboard, closeLeaderboard } from '/src/leaderboard.js';

// Wire calendar date click → navigate card stack
setDateClickHandler(goToCalendarDate);

// Wire swipe-down-to-close for all modals
addSwipeDownToClose(instrucoesModal,   closeInstrucoes);
addSwipeDownToClose(leaderboardModal,  closeLeaderboard);

// ── Event Listeners ────────────────────────────────────────────────────────
comecarPill.addEventListener('click', () => {
  if (state.presentationMode && state.queue.length > 0) activateSwipeMode(state.queue[0]);
});

activeCardArea.addEventListener('click', e => {
  if (!e.target.closest('.card')) deactivateSwipeMode();
});

document.getElementById('btn-instrucoes').addEventListener('click', openInstrucoes);
instrucoesModal.addEventListener('click', e => { if (e.target === instrucoesModal) closeInstrucoes(); });

document.getElementById('btn-leaderboard').addEventListener('click', openLeaderboard);
leaderboardModal.addEventListener('click', e => { if (e.target === leaderboardModal) closeLeaderboard(); });

modalOverlay.addEventListener('click', () => {
  if (!leaderboardModal.classList.contains('hidden')) closeLeaderboard();
  if (!instrucoesModal.classList.contains('hidden'))  closeInstrucoes();
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

document.addEventListener('keydown', e => {
  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (map[e.key]) triggerAction(map[e.key]);
});

document.getElementById('cal-prev').addEventListener('click', prevMonth);
document.getElementById('cal-next').addEventListener('click', nextMonth);

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
      return { ...img, action, timestamp: s.swiped_at };
    })
    .filter(Boolean);

  state.groupIndex = 0;
  advanceToNextPendingGroup();

  const savedDate = localStorage.getItem(ACTIVE_DATE_KEY);
  if (savedDate) {
    const idx = state.dateGroups.findIndex(g => g.date === savedDate);
    if (idx !== -1) {
      const sIds    = new Set(state.catalogue.map(e => e.id));
      const pending = state.dateGroups[idx].ids.filter(id => !sIds.has(id));
      if (pending.length > 0) { state.groupIndex = idx; state.queue = pending; }
    }
  }

  syncCalToActiveDate();
  loadingState.classList.add('hidden');
  renderStack();
  updateProgress();
}

init();
