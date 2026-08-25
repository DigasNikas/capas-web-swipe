import {
  state, ACTIONS, SWIPE_THRESHOLD, ROTATION_FACTOR,
  FEEDBACK_COLORS, API_URL, ACTIVE_DATE_KEY,
} from './state.js';
import {
  cardStack, activeCardArea, swipeHints, calSection,
  comecarPill, swipeBg, swipePill, pillIcon, pillLabel, calendarBackBtn,
  progressContainer, appTitle, voteBar,
} from './dom.js';
import { updateDateHeader, updateEmptyState, updateProgress } from './ui.js';
import { syncCalToActiveDate, renderCalendar } from './calendar.js';

export function advanceToNextPendingGroup() {
  const savedIds = new Set(state.catalogue.map(e => e.id));
  for (let i = 0; i < state.dateGroups.length; i++) {
    const pending = state.dateGroups[i].ids.filter(id => !savedIds.has(id));
    if (pending.length > 0) {
      state.groupIndex = i;
      state.queue = pending;
      return;
    }
  }
  state.groupIndex = state.dateGroups.length;
  state.queue = [];
}

function preloadNextGroup() {
  if (state.queue.length === 0) return;
  const savedIds = new Set(state.catalogue.map(e => e.id));
  for (let i = state.groupIndex + 1; i < state.dateGroups.length; i++) {
    const pending = state.dateGroups[i].ids.filter(id => !savedIds.has(id));
    if (pending.length > 0) {
      pending.forEach(id => {
        const img = state.images.find(im => im.id === id);
        if (img) { const el = new Image(); el.src = img.src; }
      });
      return;
    }
  }
}

export function renderStack() {
  const existingIds = new Set(Array.from(cardStack.children).map(el => el.dataset.id));

  Array.from(cardStack.children).forEach(el => {
    if (!state.queue.includes(el.dataset.id)) el.remove();
  });

  state.queue.forEach(id => {
    if (!existingIds.has(id)) {
      const img = state.images.find(i => i.id === id);
      if (img) cardStack.appendChild(buildCard(img, true));
    }
  });

  cardStack.classList.toggle('presentation-mode', state.presentationMode);
  cardStack.classList.remove('dimmed');
  activeCardArea.classList.add('hidden');
  activeCardArea.innerHTML = '';
  swipeHints.classList.add('hidden');
  comecarPill.classList.toggle('hidden', !state.presentationMode || state.queue.length === 0);

  if (state.presentationMode) attachActivateListener();

  updateDateHeader();
  updateEmptyState();
  preloadNextGroup();
}

// Delegated tap-or-Enter/Space-to-activate on whichever card is on top of
// the stack — re-attached with {once:true} every time the stack re-renders
// or swipe mode exits, mirroring the single top card that's actually clickable.
function attachActivateListener() {
  cardStack.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (card) activateSwipeMode(card.dataset.id);
  }, { once: true });
  cardStack.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (card) { e.preventDefault(); activateSwipeMode(card.dataset.id); }
  }, { once: true });
}

export function deactivateSwipeMode() {
  state.presentationMode = true;
  activeCardArea.classList.add('hidden');
  activeCardArea.innerHTML = '';
  swipeHints.classList.add('hidden');
  clearSwipeFeedback();
  cardStack.classList.add('presentation-mode');
  cardStack.classList.remove('dimmed');
  calSection.classList.remove('hidden');
  calendarBackBtn.classList.add('hidden');
  progressContainer.classList.remove('hidden');
  appTitle.classList.remove('hidden');
  voteBar.classList.add('hidden');
  renderCalendar();
  comecarPill.classList.toggle('hidden', state.queue.length === 0);
  attachActivateListener();
}

export function activateSwipeMode(clickedId) {
  state.presentationMode = false;
  comecarPill.classList.add('hidden');
  state.queue = [clickedId, ...state.queue.filter(id => id !== clickedId)];
  cardStack.classList.remove('presentation-mode');
  cardStack.classList.add('dimmed');
  swipeHints.classList.remove('hidden');
  calSection.classList.add('hidden');
  calendarBackBtn.classList.remove('hidden');
  progressContainer.classList.add('hidden');
  appTitle.classList.add('hidden');
  voteBar.classList.toggle('hidden', !state.settings.voteButtons);
  showActiveCard();
  updateDateHeader();
}

function showActiveCard() {
  const id  = state.queue[0];
  const img = state.images.find(i => i.id === id);
  if (!img) return;
  activeCardArea.innerHTML = '';
  const card = buildCard(img);
  card.style.animation = 'card-enter 0.25s cubic-bezier(.34,1.56,.64,1)';
  activeCardArea.appendChild(card);
  activeCardArea.classList.remove('hidden');
  attachSwipeListeners(card);
}

export function buildCard(img, interactive = false) {
  const div = document.createElement('div');
  div.className = 'card';
  div.dataset.id = img.id;

  if (interactive) {
    div.tabIndex = 0;
    div.setAttribute('role', 'button');
    div.setAttribute('aria-label', `${img.newspaper}, tocar para começar a votar`);
  }

  const image = document.createElement('img');
  image.src = img.src;
  image.alt = img.name;
  image.draggable = false;

  const labelBar = document.createElement('div');
  labelBar.className = 'card-label-bar';
  labelBar.textContent = img.newspaper.toUpperCase();

  Object.entries(ACTIONS).forEach(([dir, action]) => {
    const overlay = document.createElement('div');
    overlay.className = `swipe-overlay ${action.name}`;
    overlay.dataset.dir = dir;
    div.appendChild(overlay);
  });

  div.appendChild(image);
  div.appendChild(labelBar);
  return div;
}

function attachSwipeListeners(card) {
  if (card.dataset.listenersAttached) return;
  card.dataset.listenersAttached = '1';
  let startX = 0, startY = 0, isDragging = false;

  function onStart(x, y) {
    if (!state.settings.voteSwipe) return;
    startX = x; startY = y; isDragging = true;
    card.style.transition = 'none';
    card.style.animation  = 'none';
  }

  function onMove(x, y) {
    if (!isDragging) return;
    const dx = x - startX, dy = y - startY;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * ROTATION_FACTOR}deg)`;
    updateOverlays(card, dx, dy);
  }

  function onEnd(x, y) {
    if (!isDragging) return;
    isDragging = false;
    card.style.transition = '';
    const dx = x - startX, dy = y - startY;
    const direction = getDirection(dx, dy);
    if (direction) {
      commitSwipe(card, direction);
    } else {
      card.style.animation = '';
      card.classList.add('snap-back');
      card.style.transform = '';
      clearOverlays(card);
      card.addEventListener('animationend', () => card.classList.remove('snap-back'), { once: true });
    }
  }

  card.addEventListener('touchstart', e => {
    onStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    onMove(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });

  card.addEventListener('touchend', e => {
    onEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  });

  card.addEventListener('mousedown', e => {
    onStart(e.clientX, e.clientY);
    const onMouseMove = e => onMove(e.clientX, e.clientY);
    const onMouseUp   = e => {
      onEnd(e.clientX, e.clientY);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function getDirection(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < SWIPE_THRESHOLD && ay < SWIPE_THRESHOLD) return null;
  if (ax >= ay) return dx > 0 ? 'right' : 'left';
  return dy < 0 ? 'up' : 'down';
}

export function clearSwipeFeedback() {
  swipeBg.style.opacity = 0;
}

export function hidePill() {
  swipePill.style.opacity = 0;
}

function setSwipeFeedback(direction, progress) {
  const [r, g, b] = FEEDBACK_COLORS[direction];
  swipeBg.style.backgroundColor = `rgb(${r},${g},${b})`;
  swipeBg.style.opacity = Math.min(progress * 0.55, 0.55);
}

function updatePill(direction, progress) {
  const action = ACTIONS[direction];
  pillIcon.textContent  = action.icon;
  pillLabel.textContent = action.label;
  swipePill.dataset.dir = direction;
  swipePill.style.opacity = Math.min(progress, 1);
}

function updateOverlays(card, dx, dy) {
  const direction = getDirection(dx, dy);
  const distance  = Math.max(Math.abs(dx), Math.abs(dy));
  const progress  = distance / SWIPE_THRESHOLD;
  const opacity   = Math.min(progress * 0.9, 0.9);
  card.querySelectorAll('.swipe-overlay').forEach(o => {
    o.style.opacity = o.dataset.dir === direction ? opacity : 0;
  });
  if (direction) {
    setSwipeFeedback(direction, progress);
    updatePill(direction, progress);
  } else {
    clearSwipeFeedback();
    hidePill();
  }
}

function clearOverlays(card) {
  card.querySelectorAll('.swipe-overlay').forEach(o => (o.style.opacity = 0));
  clearSwipeFeedback();
  hidePill();
}

function commitSwipe(card, direction) {
  const id = card.dataset.id;
  card.style.animation = '';
  card.querySelectorAll('.swipe-overlay').forEach(o => {
    o.style.opacity = o.dataset.dir === direction ? 0.9 : 0;
  });
  card.classList.add(`fly-${direction}`);
  card.addEventListener('animationend', () => {
    clearSwipeFeedback();
    hidePill();
    card.remove();
    recordAction(id, ACTIONS[direction].name);
    state.queue = state.queue.filter(qid => qid !== id);
    cardStack.querySelector(`[data-id="${id}"]`)?.remove();

    if (state.queue.length === 0) {
      advanceToNextPendingGroup();
      localStorage.setItem(ACTIVE_DATE_KEY, state.dateGroups[state.groupIndex]?.date ?? '');
      syncCalToActiveDate();
      if (state.settings.keepVoting && state.queue.length > 0) {
        renderStack();
        activateSwipeMode(state.queue[0]);
      } else {
        state.presentationMode = true;
        renderStack();
      }
    } else {
      showActiveCard();
      updateDateHeader();
    }

    updateProgress();
  }, { once: true });
}

function recordAction(id, action) {
  const img = state.images.find(i => i.id === id);
  if (!img) return;
  state.catalogue = state.catalogue.filter(e => e.id !== id);
  state.catalogue.push({ ...img, action, timestamp: new Date().toISOString() });
  const decision = Object.values(ACTIONS).find(a => a.name === action)?.decision;
  fetch(`${API_URL}/swipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cover_id: Number(id), decision }),
  }).catch(() => {});
}

export function triggerAction(direction) {
  if (state.presentationMode) return;
  const card = activeCardArea.firstElementChild;
  if (!card) return;
  const overlay = card.querySelector(`.swipe-overlay[data-dir="${direction}"]`);
  if (overlay) overlay.style.opacity = 0.9;
  setSwipeFeedback(direction, 1);
  updatePill(direction, 1);
  commitSwipe(card, direction);
}

// dateGroups is newest-first, so the first entry with an unsaved id is the
// day still needing a vote closest to today — same scan
// advanceToNextPendingGroup does, just returning the date instead of
// mutating state.queue directly.
export function goToNextPendingDay() {
  const savedIds = new Set(state.catalogue.map(e => e.id));
  const pending = state.dateGroups.find(g => g.ids.some(id => !savedIds.has(id)));
  if (pending) goToCalendarDate(pending.date);
}

export function goToToday() {
  const todayStr = new Date().toISOString().slice(0, 10);
  if (state.dateGroups.some(g => g.date === todayStr)) goToCalendarDate(todayStr);
}

export function goToCalendarDate(dateStr) {
  const groupIndex = state.dateGroups.findIndex(g => g.date === dateStr);
  if (groupIndex === -1) return;

  state.groupIndex       = groupIndex;
  state.queue            = [...state.dateGroups[groupIndex].ids];
  state.presentationMode = true;
  localStorage.setItem(ACTIVE_DATE_KEY, dateStr);

  activeCardArea.classList.add('hidden');
  activeCardArea.innerHTML = '';
  swipeHints.classList.add('hidden');
  clearSwipeFeedback();
  hidePill();

  // Keeps the grid itself in sync with the jump — a cell click lands on a
  // day already on screen, but « / » (goToNextPendingDay/goToToday) can
  // land on a different month entirely, and without this the grid would
  // still show the old month with the old day highlighted .active.
  syncCalToActiveDate();
  renderCalendar();

  renderStack();
  updateProgress();
}
