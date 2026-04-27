/* ─────────────────────────────────────────────────────────────────────────
 * Avaliador de Capas — app.js
 * Loads covers from the Cloudflare Worker API (D1 + R2).
 * Images are grouped by date; all 3 covers per date must be swiped
 * before moving to the next date. Decisions are persisted in localStorage.
 * ───────────────────────────────────────────────────────────────────────── */

const STORAGE_KEY = 'swipe-catalogue';
const API_URL     = 'https://capas-scraper.digasnikas-digital.workers.dev'; // TODO: set after deploy

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
const dateHeader        = document.getElementById('date-header');
const dateLabel         = document.getElementById('date-label');
const dateProgress      = document.getElementById('date-progress');
const activeCardArea    = document.getElementById('active-card-area');
const swipeBg           = document.getElementById('swipe-bg');

// ── Constants ──────────────────────────────────────────────────────────────
const SWIPE_THRESHOLD = 80;
const ROTATION_FACTOR = 0.08;

const FEEDBACK_COLORS = {
  left:  [239, 68,  68],
  right: [34,  197, 94],
  up:    [245, 158, 11],
  down:  [99,  102, 241],
};

const ACTIONS = {
  right: { name: 'keep',     icon: '🦁', label: 'SPORTING' },
  left:  { name: 'reject',   icon: '🦅', label: 'BENFICA'  },
  up:    { name: 'favorite', icon: '?',  label: 'OUTROS'   },
  down:  { name: 'skip',     icon: '🐉', label: 'PORTO'    },
};

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

  const saved   = loadFromStorage();
  const savedIds = new Set(saved.map(e => e.id));

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

  state.catalogue = saved
    .filter(e => savedIds.has(e.id))
    .map(e => ({ ...state.images.find(i => i.id === e.id), action: e.action, timestamp: e.timestamp }))
    .filter(Boolean);

  // Start at the first group that still has unswiped images
  state.groupIndex = 0;
  advanceToNextPendingGroup();

  loadingState.classList.add('hidden');
  renderStack();
  updateProgress();
  updateCatalogueCount();
}

// ── Group navigation ───────────────────────────────────────────────────────
function advanceToNextPendingGroup() {
  const savedIds = new Set(state.catalogue.map(e => e.id));
  while (state.groupIndex < state.dateGroups.length) {
    const pending = state.dateGroups[state.groupIndex].ids.filter(id => !savedIds.has(id));
    if (pending.length > 0) {
      state.queue = pending;
      return;
    }
    state.groupIndex++;
  }
  state.queue = []; // all done
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

  if (state.presentationMode) {
    cardStack.addEventListener('click', e => {
      const card = e.target.closest('.card');
      if (card) activateSwipeMode(card.dataset.id);
    }, { once: true });
  }

  updateDateHeader();
  updateEmptyState();
}

function activateSwipeMode(clickedId) {
  state.presentationMode = false;
  // Put the clicked card first so it shows up first in the active area
  state.queue = [clickedId, ...state.queue.filter(id => id !== clickedId)];
  cardStack.classList.remove('presentation-mode');
  cardStack.classList.add('dimmed');
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
    overlay.innerHTML = `<div class="overlay-label"><span>${action.icon}</span><span>${action.label}</span></div>`;
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
  const opacity = Math.min(progress * 0.55, 0.55);
  swipeBg.style.backgroundColor = `rgb(${r},${g},${b})`;
  swipeBg.style.opacity = opacity;
}

function clearSwipeFeedback() {
  swipeBg.style.opacity = 0;
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
  } else {
    clearSwipeFeedback();
  }
}

function clearOverlays(card) {
  card.querySelectorAll('.swipe-overlay').forEach(o => (o.style.opacity = 0));
  clearSwipeFeedback();
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
    card.remove();
    recordAction(id, ACTIONS[direction].name);
    state.queue = state.queue.filter(qid => qid !== id);

    // Remove the swiped card from the presentation row too
    cardStack.querySelector(`[data-id="${id}"]`)?.remove();

    if (state.queue.length === 0) {
      state.groupIndex++;
      advanceToNextPendingGroup();
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
}

function triggerAction(direction) {
  if (state.presentationMode) return;
  const card = activeCardArea.firstElementChild;
  if (!card) return;
  const overlay = card.querySelector(`.swipe-overlay[data-dir="${direction}"]`);
  if (overlay) overlay.style.opacity = 0.9;
  setSwipeFeedback(direction, 1);
  commitSwipe(card, direction);
}

// ── UI Updates ─────────────────────────────────────────────────────────────
function updateEmptyState() {
  const hasQueue = state.queue.length > 0;
  cardStack.style.display = hasQueue ? '' : 'none';
  emptyState.classList.toggle('hidden', hasQueue);
  dateHeader.classList.toggle('hidden', !hasQueue);
  progressContainer.classList.toggle('hidden', state.images.length === 0);
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
    const savedIds = new Set(state.catalogue.map(e => e.id));
    const total    = group.ids.length;
    const done     = group.ids.filter(id => savedIds.has(id)).length;
    dateProgress.textContent = `${done + 1} / ${total}`;
    dateProgress.classList.remove('hint');
  }
}

function updateProgress() {
  const total = state.dateGroups.length;
  const done  = state.groupIndex;
  progressBar.style.setProperty('--progress', `${total ? Math.round((done / total) * 100) : 0}%`);
  progressText.textContent = `${done} / ${total} days`;
}

function updateCatalogueCount() {
  catalogueCount.textContent = state.catalogue.length;
}

// ── Catalogue Modal ────────────────────────────────────────────────────────
let activeFilter = 'all';

function openCatalogue() {
  catalogueModal.classList.remove('hidden');
  modalOverlay.classList.remove('hidden');
  renderCatalogueGrid(activeFilter);
}

function closeCatalogue() {
  catalogueModal.classList.add('hidden');
  modalOverlay.classList.add('hidden');
}

function renderCatalogueGrid(filter) {
  activeFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.filter === filter)
  );
  const items = filter === 'all' ? state.catalogue : state.catalogue.filter(e => e.action === filter);
  catalogueEmpty.classList.toggle('hidden', items.length > 0);
  catalogueGrid.innerHTML = '';
  items.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'catalogue-item';
    const img = document.createElement('img');
    img.src = entry.src; img.alt = entry.name;
    const badge = document.createElement('div');
    badge.className = `catalogue-item-badge ${entry.action}`;
    badge.textContent = ACTIONS[actionToDir(entry.action)]?.icon ?? '?';
    const name = document.createElement('div');
    name.className = 'catalogue-item-name';
    name.textContent = entry.name;
    div.append(img, badge, name);
    catalogueGrid.appendChild(div);
  });
}

function actionToDir(action) {
  return Object.keys(ACTIONS).find(d => ACTIONS[d].name === action);
}

// ── Event Listeners ────────────────────────────────────────────────────────
document.getElementById('btn-view-catalogue').addEventListener('click', openCatalogue);
document.getElementById('btn-close-modal').addEventListener('click', closeCatalogue);
modalOverlay.addEventListener('click', closeCatalogue);

document.querySelectorAll('.filter-btn').forEach(btn =>
  btn.addEventListener('click', () => renderCatalogueGrid(btn.dataset.filter))
);

document.getElementById('btn-reset').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  state.catalogue       = [];
  state.groupIndex      = 0;
  state.presentationMode = true;
  advanceToNextPendingGroup();
  renderStack();
  updateProgress();
  updateCatalogueCount();
});

document.addEventListener('keydown', e => {
  if (!catalogueModal.classList.contains('hidden')) return;
  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (map[e.key]) triggerAction(map[e.key]);
});

// ── Start ──────────────────────────────────────────────────────────────────
init();
