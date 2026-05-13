/* ─────────────────────────────────────────────────────────────────────────
 * Avaliador de Capas — app.js
 * Loads covers from the Cloudflare Worker API (D1 + R2).
 * Images are grouped by date; all 3 covers per date must be swiped
 * before moving to the next date. Decisions are persisted in localStorage.
 * ───────────────────────────────────────────────────────────────────────── */

const STORAGE_KEY      = 'swipe-catalogue';
const ONBOARD_KEY      = 'capas-onboarded';
const ACTIVE_DATE_KEY  = 'capas-active-date';
const API_URL      = '/api';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  images:           [],     // { id, name, src, newspaper, date }
  dateGroups:       [],     // [{ date, ids[] }] sorted date desc
  groupIndex:       0,      // which date group is active
  queue:            [],     // ids in current group not yet swiped
  catalogue:        [],     // { id, name, src, newspaper, date, action, timestamp }
  presentationMode: true,   // true = showing cards, waiting for tap to start swiping
};


// ── DOM refs ───────────────────────────────────────────────────────────────
const cardStack         = document.getElementById('card-stack');
const emptyState        = document.getElementById('empty-state');
const loadingState      = document.getElementById('loading-state');
const progressContainer = document.getElementById('progress-bar-container');
const progressBar       = document.getElementById('progress-bar');
const progressText      = document.getElementById('progress-text');
const catalogueCount    = document.getElementById('catalogue-count');
const catalogueModal    = document.getElementById('catalogue-modal');
const catalogueGrid     = document.getElementById('catalogue-grid');
const catalogueEmpty    = document.getElementById('catalogue-empty');
const modalOverlay      = document.getElementById('modal-overlay');
const leaderboardModal  = document.getElementById('leaderboard-modal');
const leaderboardList   = document.getElementById('leaderboard-list');
const instrucoesModal   = document.getElementById('instrucoes-modal');
const dateHeader        = document.getElementById('date-header');
const dateLabel         = document.getElementById('date-label');
const dateProgress      = document.getElementById('date-progress');
const activeCardArea    = document.getElementById('active-card-area');
const swipeBg           = document.getElementById('swipe-bg');
const swipeHints        = document.getElementById('swipe-hints');
const calSection        = document.getElementById('calendar-section');
const calMonthLabel     = document.getElementById('cal-month-label');
const calGrid           = document.getElementById('calendar-grid');
const swipePill         = document.getElementById('swipe-pill');
const pillIcon          = document.getElementById('pill-icon');
const pillLabel         = document.getElementById('pill-label');
const comecarPill       = document.getElementById('comecar-pill');

// ── Constants ──────────────────────────────────────────────────────────────
const SWIPE_THRESHOLD = 80;
const ROTATION_FACTOR = 0.08;

const FEEDBACK_COLORS = {
  left:  [239, 68,  68],
  right: [34,  197, 94],
  up:    [245, 158, 11],
  down:  [99,  102, 241],
};

let calViewYear  = new Date().getFullYear();
let calViewMonth = new Date().getMonth();

const CAL_HEADERS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

const ACTIONS = {
  right: { name: 'keep',     icon: '🦁', label: 'SPORTING', decision: 'sporting' },
  left:  { name: 'reject',   icon: '🦅', label: 'BENFICA',  decision: 'benfica'  },
  up:    { name: 'favorite', icon: '?',  label: 'OUTROS',   decision: 'others'   },
  down:  { name: 'skip',     icon: '🐉', label: 'PORTO',    decision: 'porto'    },
};

// Reverse map: server decision value → local action name
const DECISION_TO_ACTION = Object.fromEntries(
  Object.values(ACTIONS).map(a => [a.decision, a.name])
);

// ── Persistence ────────────────────────────────────────────────────────────
function loadFromStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.catalogue));
}

// ── Date grouping ──────────────────────────────────────────────────────────
function groupByDate(images) {
  const map = new Map();
  for (const img of images) {
    if (!map.has(img.date)) map.set(img.date, []);
    map.get(img.date).push(img.id);
  }
  return [...map.keys()]
    .sort((a, b) => b.localeCompare(a))       // newest first
    .map(date => ({ date, ids: map.get(date) }));
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-PT', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

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

  // Prefer server history (persists across devices/sessions); fall back to localStorage
  let serverSwipes = null;
  try {
    const res = await fetch(`${API_URL}/swipes`);
    if (res.ok) serverSwipes = await res.json();
  } catch { /* network error — use cache */ }

  if (serverSwipes) {
    state.catalogue = serverSwipes
      .map(s => {
        const img    = state.images.find(i => i.id === String(s.cover_id));
        const action = DECISION_TO_ACTION[s.decision];
        if (!img || !action) return null;
        return { ...img, action, timestamp: s.swiped_at };
      })
      .filter(Boolean);
    saveToStorage(); // keep localStorage in sync as a cache
  } else {
    const saved = loadFromStorage();
    state.catalogue = saved
      .map(e => {
        const img = state.images.find(i => i.id === e.id);
        if (!img) return null;
        return { ...img, action: e.action, timestamp: e.timestamp };
      })
      .filter(Boolean);
  }

  // Start at the first group that still has unswiped images
  state.groupIndex = 0;
  advanceToNextPendingGroup();

  // Restore the specific date the user was last on
  const savedDate = localStorage.getItem(ACTIVE_DATE_KEY);
  if (savedDate) {
    const idx = state.dateGroups.findIndex(g => g.date === savedDate);
    if (idx !== -1) {
      const sIds = new Set(state.catalogue.map(e => e.id));
      const pending = state.dateGroups[idx].ids.filter(id => !sIds.has(id));
      if (pending.length > 0) { state.groupIndex = idx; state.queue = pending; }
    }
  }


  syncCalToActiveDate();

  loadingState.classList.add('hidden');
  renderStack();
  updateProgress();
  updateCatalogueCount();
}

// ── Group navigation ───────────────────────────────────────────────────────
function advanceToNextPendingGroup() {
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

// ── Preloading ─────────────────────────────────────────────────────────────
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

// ── Stack Rendering ────────────────────────────────────────────────────────
function renderStack() {
  const existingIds = new Set(Array.from(cardStack.children).map(el => el.dataset.id));

  Array.from(cardStack.children).forEach(el => {
    if (!state.queue.includes(el.dataset.id)) el.remove();
  });

  state.queue.forEach(id => {
    if (!existingIds.has(id)) {
      const img = state.images.find(i => i.id === id);
      if (img) cardStack.appendChild(buildCard(img));
    }
  });

  cardStack.classList.toggle('presentation-mode', state.presentationMode);
  cardStack.classList.remove('dimmed');
  activeCardArea.classList.add('hidden');
  activeCardArea.innerHTML = '';
  swipeHints.classList.add('hidden');
  comecarPill.classList.toggle('hidden', !state.presentationMode || state.queue.length === 0);

  if (state.presentationMode) {
    cardStack.addEventListener('click', e => {
      const card = e.target.closest('.card');
      if (card) activateSwipeMode(card.dataset.id);
    }, { once: true });
  }

  updateDateHeader();
  updateEmptyState();
  preloadNextGroup();
}

function deactivateSwipeMode() {
  state.presentationMode = true;
  activeCardArea.classList.add('hidden');
  activeCardArea.innerHTML = '';
  swipeHints.classList.add('hidden');
  clearSwipeFeedback();
  cardStack.classList.add('presentation-mode');
  cardStack.classList.remove('dimmed');
  calSection.classList.remove('hidden');
  renderCalendar();
  comecarPill.classList.toggle('hidden', state.queue.length === 0);
  cardStack.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (card) activateSwipeMode(card.dataset.id);
  }, { once: true });
}

function activateSwipeMode(clickedId) {
  state.presentationMode = false;
  comecarPill.classList.add('hidden');
  // Put the clicked card first so it shows up first in the active area
  state.queue = [clickedId, ...state.queue.filter(id => id !== clickedId)];
  cardStack.classList.remove('presentation-mode');
  cardStack.classList.add('dimmed');
  swipeHints.classList.remove('hidden');
  calSection.classList.add('hidden');
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

function buildCard(img) {
  const div = document.createElement('div');
  div.className = 'card';
  div.dataset.id = img.id;

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

// ── Swipe Gesture Logic ────────────────────────────────────────────────────
function attachSwipeListeners(card) {
  if (card.dataset.listenersAttached) return;
  card.dataset.listenersAttached = '1';
  let startX = 0, startY = 0, isDragging = false;

  function onStart(x, y) {
    startX = x; startY = y; isDragging = true;
    card.style.transition = 'none';
    card.style.animation  = 'none';  // cancel card-enter fill so transform isn't blocked
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
      card.style.animation = '';  // clear inline so snap-back CSS class can run
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

function setSwipeFeedback(direction, progress) {
  const [r, g, b] = FEEDBACK_COLORS[direction];
  swipeBg.style.backgroundColor = `rgb(${r},${g},${b})`;
  swipeBg.style.opacity = Math.min(progress * 0.55, 0.55);
}

function clearSwipeFeedback() {
  swipeBg.style.opacity = 0;
}

function updatePill(direction, progress) {
  const action = ACTIONS[direction];
  pillIcon.textContent  = action.icon;
  pillLabel.textContent = action.label;
  swipePill.dataset.dir = direction;
  swipePill.style.opacity = Math.min(progress, 1);
}

function hidePill() {
  swipePill.style.opacity = 0;
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

// ── Committing a Swipe ─────────────────────────────────────────────────────
function commitSwipe(card, direction) {
  const id = card.dataset.id;
  card.style.animation = '';  // clear inline so fly-* CSS class can run
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

    // Remove the swiped card from the presentation row too
    cardStack.querySelector(`[data-id="${id}"]`)?.remove();

    if (state.queue.length === 0) {
      advanceToNextPendingGroup();
      localStorage.setItem(ACTIVE_DATE_KEY, state.dateGroups[state.groupIndex]?.date ?? '');
      syncCalToActiveDate();
      state.presentationMode = true;
      renderStack();
    } else {
      showActiveCard();
      updateDateHeader();
    }

    updateProgress();
    updateCatalogueCount();
  }, { once: true });
}

function recordAction(id, action) {
  const img = state.images.find(i => i.id === id);
  if (!img) return;
  state.catalogue = state.catalogue.filter(e => e.id !== id);
  state.catalogue.push({ ...img, action, timestamp: new Date().toISOString() });
  saveToStorage();
  const decision = Object.values(ACTIONS).find(a => a.name === action)?.decision;
  fetch(`${API_URL}/swipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cover_id: Number(id), decision }),
  }).catch(() => {});
}

function triggerAction(direction) {
  if (state.presentationMode) return;
  const card = activeCardArea.firstElementChild;
  if (!card) return;
  const overlay = card.querySelector(`.swipe-overlay[data-dir="${direction}"]`);
  if (overlay) overlay.style.opacity = 0.9;
  setSwipeFeedback(direction, 1);
  updatePill(direction, 1);
  commitSwipe(card, direction);
}

// ── Calendar ───────────────────────────────────────────────────────────────
function syncCalToActiveDate() {
  const d = state.dateGroups[state.groupIndex]?.date;
  if (d) { calViewYear = +d.slice(0, 4); calViewMonth = +d.slice(5, 7) - 1; }
}

function goToCalendarDate(dateStr) {
  const groupIndex = state.dateGroups.findIndex(g => g.date === dateStr);
  if (groupIndex === -1) return;

  state.groupIndex      = groupIndex;
  state.queue           = [...state.dateGroups[groupIndex].ids];
  state.presentationMode = true;
  localStorage.setItem(ACTIVE_DATE_KEY, dateStr);

  activeCardArea.classList.add('hidden');
  activeCardArea.innerHTML = '';
  swipeHints.classList.add('hidden');
  clearSwipeFeedback();
  hidePill();

  renderStack();
  updateProgress();
  updateCatalogueCount();
}

function renderCalendar() {
  const savedIds       = new Set(state.catalogue.map(e => e.id));
  const completedDates = new Set(
    state.dateGroups.filter(g => g.ids.every(id => savedIds.has(id))).map(g => g.date)
  );
  const activeDate = state.dateGroups[state.groupIndex]?.date;
  const allDates   = new Set(state.dateGroups.map(g => g.date));

  calMonthLabel.textContent = new Date(calViewYear, calViewMonth, 1)
    .toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

  const offset   = (new Date(calViewYear, calViewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

  calGrid.innerHTML = '';

  CAL_HEADERS.forEach(h => {
    const el = document.createElement('div');
    el.className = 'cal-day-header';
    el.textContent = h;
    calGrid.appendChild(el);
  });

  for (let i = 0; i < offset; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    calGrid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${calViewYear}-${String(calViewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const el = document.createElement('div');
    el.className = 'cal-day';
    if      (completedDates.has(ds)) el.classList.add('completed');
    else if (ds === activeDate)      el.classList.add('active');
    else if (allDates.has(ds))       el.classList.add('pending');
    el.textContent = d;

    if (allDates.has(ds)) {
      el.classList.add('has-data');
      el.addEventListener('click', () => goToCalendarDate(ds));
    }
    calGrid.appendChild(el);
  }
}

// ── UI Updates ─────────────────────────────────────────────────────────────
function updateEmptyState() {
  const hasQueue = state.queue.length > 0;
  cardStack.style.display = hasQueue ? '' : 'none';
  emptyState.classList.toggle('hidden', hasQueue);
  dateHeader.classList.toggle('hidden', !hasQueue);
  progressContainer.classList.toggle('hidden', state.images.length === 0);
  calSection.classList.toggle('hidden', state.images.length === 0);
  if (!hasQueue) activeCardArea.classList.add('hidden');
}

function updateDateHeader() {
  const group = state.dateGroups[state.groupIndex];
  if (!group) return;
  dateLabel.textContent = formatDate(group.date);
  if (state.presentationMode) {
    dateProgress.textContent = 'tap to start';
    dateProgress.classList.add('hint');
  } else {
    const total    = group.ids.length;
    const current  = total - state.queue.length + 1;
    dateProgress.textContent = `${current} / ${total}`;
    dateProgress.classList.remove('hint');
  }
}

function updateProgress() {
  const total    = state.dateGroups.length;
  const savedIds = new Set(state.catalogue.map(e => e.id));
  const done     = state.dateGroups.filter(g => g.ids.every(id => savedIds.has(id))).length;
  progressBar.style.setProperty('--progress', `${total ? Math.round((done / total) * 100) : 0}%`);
  progressText.textContent = `${done} / ${total} days`;
  renderCalendar();
}

function updateCatalogueCount() {
  catalogueCount.textContent = state.catalogue.length;
}

// ── Catalogue Modal ────────────────────────────────────────────────────────
let activeFilter = 'all';
let drillLevel   = 0;   // 0=filter bundle  1=month bundles  2=card grid
let drillMonth   = null; // 'YYYY-MM'

const FILTER_LABELS = { all: 'Tudo', keep: 'Sporting', reject: 'Benfica', skip: 'Porto', favorite: 'Outros' };

function openCatalogue() {
  catalogueModal.classList.remove('hidden');
  modalOverlay.classList.remove('hidden');
  drillLevel = 0;
  drillMonth = null;
  renderCatalogueView();
}

function closeCatalogue() {
  animateModalClose(catalogueModal, () => {
    catalogueModal.classList.add('hidden');
    modalOverlay.classList.add('hidden');
  });
}

function renderCatalogueView() {
  document.querySelectorAll('.filter-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.filter === activeFilter)
  );

  catalogueGrid.innerHTML = '';
  catalogueGrid.classList.remove('grid-view');

  const catNav   = document.getElementById('catalogue-nav');
  const navLabel = document.getElementById('catalogue-nav-label');
  catNav.classList.toggle('hidden', drillLevel === 0);

  const items = activeFilter === 'all'
    ? state.catalogue
    : state.catalogue.filter(e => e.action === activeFilter);

  catalogueEmpty.classList.toggle('hidden', items.length > 0);
  if (items.length === 0) return;

  if (drillLevel === 0) {
    navLabel.textContent = '';
    catalogueGrid.appendChild(
      buildBundle(items, () => { drillLevel = 1; renderCatalogueView(); })
    );

  } else if (drillLevel === 1) {
    navLabel.textContent = FILTER_LABELS[activeFilter];
    const monthGrid = document.createElement('div');
    monthGrid.className = 'cat-month-grid';
    groupByMonth(items).forEach(({ key, label, items: mi }) => {
      monthGrid.appendChild(
        buildMonthBundle(mi, label, () => { drillMonth = key; drillLevel = 2; renderCatalogueView(); })
      );
    });
    catalogueGrid.appendChild(monthGrid);

  } else {
    const monthItems = items.filter(e => e.date.slice(0, 7) === drillMonth);
    navLabel.textContent = `${FILTER_LABELS[activeFilter]} · ${formatMonth(drillMonth)}`;
    catalogueEmpty.classList.toggle('hidden', monthItems.length > 0);
    if (monthItems.length > 0) expandGrid(monthItems);
  }
}

function groupByMonth(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.date.slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map(key => ({ key, label: formatMonth(key), items: map.get(key) }));
}

function formatMonth(key) {
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
}

function buildBundle(items, onClick) {
  const bundle = document.createElement('div');
  bundle.className = 'cat-bundle';

  const stack = buildBundleStack(items);

  const label = document.createElement('div');
  label.className = 'bundle-label';
  label.textContent = `${items.length} ${items.length === 1 ? 'capa' : 'capas'}`;

  const hint = document.createElement('div');
  hint.className = 'bundle-hint';
  hint.textContent = 'toca para ver';

  bundle.appendChild(stack);
  bundle.appendChild(label);
  bundle.appendChild(hint);
  bundle.addEventListener('click', onClick);
  return bundle;
}

function buildMonthBundle(items, label, onClick) {
  const div = document.createElement('div');
  div.className = 'cat-month-item';

  const stack = buildBundleStack(items);

  const monthLabel = document.createElement('div');
  monthLabel.className = 'cat-month-label';
  monthLabel.textContent = label;

  div.appendChild(stack);
  div.appendChild(monthLabel);
  div.addEventListener('click', onClick);
  return div;
}

function buildBundleStack(items) {
  const stack = document.createElement('div');
  stack.className = 'bundle-stack';

  const count = Math.min(items.length, 3);
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = `bundle-card bc-${i}`;
    const img = document.createElement('img');
    img.src = items[i].src;
    img.alt = items[i].name;
    card.appendChild(img);
    stack.appendChild(card);
  }

  const countBadge = document.createElement('div');
  countBadge.className = 'bundle-count-badge';
  countBadge.textContent = items.length;
  stack.appendChild(countBadge);

  return stack;
}

const SHORT_MONTHS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

function expandGrid(items) {
  catalogueGrid.innerHTML = '';
  catalogueGrid.classList.add('grid-view');
  items.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'catalogue-item';

    const img = document.createElement('img');
    img.src = entry.src; img.alt = entry.name;

    const badge = document.createElement('div');
    badge.className = `catalogue-item-badge ${entry.action}`;
    badge.textContent = ACTIONS[actionToDir(entry.action)]?.icon ?? '?';

    const footer = document.createElement('div');
    footer.className = 'catalogue-item-footer';

    const date = document.createElement('div');
    date.className = 'catalogue-item-date';
    date.textContent = formatShortDate(entry.date);

    const name = document.createElement('div');
    name.className = 'catalogue-item-name';
    name.textContent = entry.name;

    footer.append(date, name);
    div.append(img, badge, footer);
    catalogueGrid.appendChild(div);
  });
}

function actionToDir(action) {
  return Object.keys(ACTIONS).find(d => ACTIONS[d].name === action);
}

// ── Instruções modal ───────────────────────────────────────────────────────
function openInstrucoes() {
  instrucoesModal.classList.remove('hidden');
  modalOverlay.classList.remove('hidden');
}
function closeInstrucoes() {
  animateModalClose(instrucoesModal, () => {
    instrucoesModal.classList.add('hidden');
    modalOverlay.classList.add('hidden');
  });
}

// ── Leaderboard ────────────────────────────────────────────────────────────
async function openLeaderboard() {
  leaderboardList.innerHTML = '<li class="lb-loading">A carregar…</li>';
  leaderboardModal.classList.remove('hidden');
  modalOverlay.classList.remove('hidden');

  try {
    const res = await fetch(`${API_URL}/leaderboard`);
    const data = res.ok ? await res.json() : [];
    leaderboardList.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
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

function closeLeaderboard() {
  animateModalClose(leaderboardModal, () => {
    leaderboardModal.classList.add('hidden');
    modalOverlay.classList.add('hidden');
  });
}

// ── Modal close helpers ────────────────────────────────────────────────────
function animateModalClose(modal, onDone) {
  const content = modal.querySelector('.modal-content');
  if (!content) { onDone(); return; }
  content.style.animation = 'slide-down 0.28s cubic-bezier(0.32, 0.72, 0, 1) forwards';
  setTimeout(() => {
    content.style.animation = '';
    onDone();
  }, 280);
}

function addSwipeDownToClose(modal, closeFn) {
  const content = modal.querySelector('.modal-content');
  let startY = 0, dragging = false;

  content.addEventListener('touchstart', e => {
    startY   = e.touches[0].clientY;
    dragging = true;
    content.style.transition = 'none';
  }, { passive: true });

  content.addEventListener('touchmove', e => {
    if (!dragging) return;
    const dy = Math.max(0, e.touches[0].clientY - startY);
    content.style.transform = `translateY(${dy}px)`;
  }, { passive: true });

  content.addEventListener('touchend', e => {
    if (!dragging) return;
    dragging = false;
    const dy = e.changedTouches[0].clientY - startY;
    content.style.transition = '';
    content.style.transform  = '';
    if (dy > 80) closeFn();
  });
}

// ── Event Listeners ────────────────────────────────────────────────────────
comecarPill.addEventListener('click', () => {
  if (state.presentationMode && state.queue.length > 0) activateSwipeMode(state.queue[0]);
});

document.body.addEventListener('click', e => {
  if (!state.presentationMode && !e.target.closest('.card')) deactivateSwipeMode();
});

document.getElementById('btn-instrucoes').addEventListener('click', openInstrucoes);
instrucoesModal.addEventListener('click', e => { if (e.target === instrucoesModal) closeInstrucoes(); });
addSwipeDownToClose(instrucoesModal, closeInstrucoes);

document.getElementById('btn-view-catalogue').addEventListener('click', openCatalogue);
catalogueModal.addEventListener('click', e => { if (e.target === catalogueModal) closeCatalogue(); });
modalOverlay.addEventListener('click', () => {
  if (!catalogueModal.classList.contains('hidden'))  closeCatalogue();
  if (!leaderboardModal.classList.contains('hidden')) closeLeaderboard();
  if (!instrucoesModal.classList.contains('hidden'))  closeInstrucoes();
});
addSwipeDownToClose(catalogueModal, closeCatalogue);

document.getElementById('btn-leaderboard').addEventListener('click', openLeaderboard);
leaderboardModal.addEventListener('click', e => { if (e.target === leaderboardModal) closeLeaderboard(); });
addSwipeDownToClose(leaderboardModal, closeLeaderboard);

document.querySelectorAll('.filter-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter;
    drillLevel = 0;
    drillMonth = null;
    renderCatalogueView();
  })
);

document.getElementById('btn-catalogue-back').addEventListener('click', () => {
  drillLevel = Math.max(0, drillLevel - 1);
  if (drillLevel < 2) drillMonth = null;
  renderCatalogueView();
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
  syncCalToActiveDate();
  renderStack();
  updateProgress();
  updateCatalogueCount();
});

document.addEventListener('keydown', e => {
  if (!catalogueModal.classList.contains('hidden')) return;
  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (map[e.key]) triggerAction(map[e.key]);
});

document.getElementById('cal-prev').addEventListener('click', () => {
  calViewMonth--;
  if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
  renderCalendar();
});

document.getElementById('cal-next').addEventListener('click', () => {
  calViewMonth++;
  if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
  renderCalendar();
});

// ── Landing page ───────────────────────────────────────────────────────────
const landingPage = document.getElementById('landing-page');

function dismissLanding() {
  localStorage.setItem(ONBOARD_KEY, '1');
  landingPage.classList.add('is-dismissed');
}

// Hide instantly (no animation) for returning users
if (localStorage.getItem(ONBOARD_KEY)) {
  landingPage.style.transition = 'none';
  landingPage.classList.add('is-dismissed');
  requestAnimationFrame(() => { landingPage.style.transition = ''; });
}

document.getElementById('btn-landing-start').addEventListener('click', dismissLanding);

// ── Start ──────────────────────────────────────────────────────────────────
init();
