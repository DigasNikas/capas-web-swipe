/* ─────────────────────────────────────────────────────────────────────────
 * Swipe Cataloguer — app.js
 * Auto-loads images from images/manifest.json. Each image is shown once;
 * catalogue decisions are persisted in localStorage.
 * ───────────────────────────────────────────────────────────────────────── */

const STORAGE_KEY = 'swipe-catalogue';
const MANIFEST    = 'images/manifest.json';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  images: [],    // { id, name, src }  — full image list from manifest
  queue: [],     // ids not yet catalogued this session
  catalogue: [], // { id, name, src, action, timestamp }
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
const cardArea          = document.getElementById('card-area');

// ── Constants ──────────────────────────────────────────────────────────────
const SWIPE_THRESHOLD = 80;
const ROTATION_FACTOR = 0.08;

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

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  loadingState.classList.remove('hidden');

  const saved = loadFromStorage();
  const savedIds = new Set(saved.map(e => e.id));

  let filenames;
  try {
    const res = await fetch(MANIFEST);
    filenames = await res.json();
  } catch (err) {
    loadingState.querySelector('p').textContent = 'Failed to load images.';
    return;
  }

  state.images = filenames.map(name => ({
    id:  name,
    name,
    src: `images/${name}`,
  }));

  // Restore saved catalogue entries (with up-to-date src path)
  state.catalogue = saved.filter(e => savedIds.has(e.id)).map(e => ({
    ...state.images.find(i => i.id === e.id),
    action: e.action,
    timestamp: e.timestamp,
  }));

  // Queue = images not yet catalogued
  state.queue = state.images.map(i => i.id).filter(id => !savedIds.has(id));

  loadingState.classList.add('hidden');
  renderStack();
  updateProgress();
  updateCatalogueCount();
}

// ── Stack Rendering ────────────────────────────────────────────────────────
function renderStack() {
  const topIds = state.queue.slice(0, 3);
  const existingIds = new Set(Array.from(cardStack.children).map(el => el.dataset.id));

  Array.from(cardStack.children).forEach(el => {
    if (!topIds.includes(el.dataset.id)) el.remove();
  });

  topIds.filter(id => !existingIds.has(id)).forEach(id => {
    const img = state.images.find(i => i.id === id);
    if (img) cardStack.appendChild(buildCard(img));
  });

  // Ensure queue[0] is the last child (rendered on top)
  topIds.slice().reverse().forEach(id => {
    const el = cardStack.querySelector(`[data-id="${id}"]`);
    if (el) cardStack.appendChild(el);
  });

  Array.from(cardStack.children).forEach((c, i, arr) =>
    c.classList.toggle('top', i === arr.length - 1)
  );

  const topCard = cardStack.lastElementChild;
  if (topCard) attachSwipeListeners(topCard);

  updateEmptyState();
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
  labelBar.textContent = img.name;

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
  let startX = 0, startY = 0, isDragging = false;

  function onStart(x, y) {
    startX = x; startY = y; isDragging = true;
    card.style.transition = 'none';
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

function updateOverlays(card, dx, dy) {
  const direction = getDirection(dx, dy);
  const distance  = Math.max(Math.abs(dx), Math.abs(dy));
  const opacity   = Math.min((distance / SWIPE_THRESHOLD) * 0.9, 0.9);
  card.querySelectorAll('.swipe-overlay').forEach(o => {
    o.style.opacity = o.dataset.dir === direction ? opacity : 0;
  });
}

function clearOverlays(card) {
  card.querySelectorAll('.swipe-overlay').forEach(o => (o.style.opacity = 0));
}

// ── Committing a Swipe ─────────────────────────────────────────────────────
function commitSwipe(card, direction) {
  const id = card.dataset.id;
  card.querySelectorAll('.swipe-overlay').forEach(o => {
    o.style.opacity = o.dataset.dir === direction ? 0.9 : 0;
  });
  card.classList.add(`fly-${direction}`);
  card.addEventListener('animationend', () => {
    card.remove();
    recordAction(id, ACTIONS[direction].name);
    state.queue = state.queue.filter(qid => qid !== id);
    renderStack();
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
  const topCard = cardStack.lastElementChild;
  if (!topCard) return;
  const overlay = topCard.querySelector(`.swipe-overlay[data-dir="${direction}"]`);
  if (overlay) overlay.style.opacity = 0.9;
  commitSwipe(topCard, direction);
}

// ── UI Updates ─────────────────────────────────────────────────────────────
function updateEmptyState() {
  const hasQueue = state.queue.length > 0;
  cardStack.style.display = hasQueue ? '' : 'none';
  emptyState.classList.toggle('hidden', hasQueue);
  progressContainer.classList.toggle('hidden', state.images.length === 0);
}

function updateProgress() {
  const total = state.images.length;
  const done  = state.catalogue.length;
  progressBar.style.setProperty('--progress', `${total ? Math.round((done / total) * 100) : 0}%`);
  progressText.textContent = `${done} / ${total}`;
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

// ── Export ─────────────────────────────────────────────────────────────────
function exportCatalogue() {
  const data = state.catalogue.map(({ id, name, action, timestamp }) => ({ id, name, action, timestamp }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `catalogue-${Date.now()}.json` });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Event Listeners ────────────────────────────────────────────────────────
document.getElementById('btn-view-catalogue').addEventListener('click', openCatalogue);
document.getElementById('btn-close-modal').addEventListener('click', closeCatalogue);
modalOverlay.addEventListener('click', closeCatalogue);

document.querySelectorAll('.filter-btn').forEach(btn =>
  btn.addEventListener('click', () => renderCatalogueGrid(btn.dataset.filter))
);

document.getElementById('btn-export').addEventListener('click', exportCatalogue);

document.getElementById('btn-reset').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  state.catalogue = [];
  state.queue = state.images.map(i => i.id);
  renderStack();
  updateProgress();
  updateCatalogueCount();
});

document.querySelectorAll('.action-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    const dir = actionToDir(btn.dataset.action);
    if (dir) triggerAction(dir);
  })
);

document.addEventListener('keydown', e => {
  if (!catalogueModal.classList.contains('hidden')) return;
  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (map[e.key]) triggerAction(map[e.key]);
});

// ── Start ──────────────────────────────────────────────────────────────────
init();
