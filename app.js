/* ─────────────────────────────────────────────────────────────────────────
 * Swipe Cataloguer — app.js
 * Handles image loading, card rendering, swipe gestures (touch + mouse),
 * and catalogue management.
 * ───────────────────────────────────────────────────────────────────────── */

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  images: [],        // { id, name, src }
  queue: [],         // indices into images[], current unprocessed
  catalogue: [],     // { id, name, src, action, timestamp }
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const cardStack          = document.getElementById('card-stack');
const emptyState         = document.getElementById('empty-state');
const noImagesState      = document.getElementById('no-images-state');
const progressContainer  = document.getElementById('progress-bar-container');
const progressBar        = document.getElementById('progress-bar');
const progressText       = document.getElementById('progress-text');
const catalogueCount     = document.getElementById('catalogue-count');
const catalogueModal     = document.getElementById('catalogue-modal');
const catalogueGrid      = document.getElementById('catalogue-grid');
const catalogueEmpty     = document.getElementById('catalogue-empty');
const modalOverlay       = document.getElementById('modal-overlay');
const fileInput          = document.getElementById('file-input');
const cardArea           = document.getElementById('card-area');

// ── Constants ──────────────────────────────────────────────────────────────
const SWIPE_THRESHOLD = 80;  // px needed to commit a swipe
const ROTATION_FACTOR = 0.08; // degrees per px of horizontal drag

const ACTIONS = {
  right: { name: 'keep',     icon: '🦁',  label: 'SPORTING' },
  left:  { name: 'reject',   icon: '🦅',  label: 'BENFICA' },
  up:    { name: 'favorite', icon: '?',   label: 'OUTROS' },
  down:  { name: 'skip',     icon: '🐉',  label: 'PORTO' },
};

// ── Image Loading ──────────────────────────────────────────────────────────
function loadFiles(files) {
  const readers = Array.from(files).map(file => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve({ id: crypto.randomUUID(), name: file.name, src: e.target.result });
    reader.readAsDataURL(file);
  }));

  Promise.all(readers).then(newImages => {
    state.images.push(...newImages);
    state.queue.push(...newImages.map(img => img.id));
    renderStack();
    updateProgress();
  });
}

// ── Stack Rendering ────────────────────────────────────────────────────────
function renderStack() {
  // Show top 3 cards only for performance
  const topIds = state.queue.slice(0, 3);
  const existingIds = new Set(
    Array.from(cardStack.children).map(el => el.dataset.id)
  );

  // Remove cards no longer needed
  Array.from(cardStack.children).forEach(el => {
    if (!topIds.includes(el.dataset.id)) el.remove();
  });

  // Build cards in reverse so the first in queue is on top (z-index top)
  const toCreate = topIds.filter(id => !existingIds.has(id));
  toCreate.forEach(id => {
    const img = state.images.find(i => i.id === id);
    if (img) cardStack.appendChild(buildCard(img));
  });

  // Re-order: top card is last child (highest z-index via .top class)
  const cards = Array.from(cardStack.children);
  cards.forEach((c, i) => {
    c.classList.toggle('top', i === cards.length - 1);
    // Ensure the newest top card is last in the DOM
  });
  // DOM order: first child = furthest back, last child = top
  // Reorder DOM so queue[0] is LAST child (on top)
  topIds.slice().reverse().forEach(id => {
    const el = cardStack.querySelector(`[data-id="${id}"]`);
    if (el) cardStack.appendChild(el); // move to end
  });

  // Mark top card
  const allCards = Array.from(cardStack.children);
  allCards.forEach((c, i) => c.classList.toggle('top', i === allCards.length - 1));

  // Attach swipe listeners only to the top card
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

  // Overlays for each direction
  Object.entries(ACTIONS).forEach(([dir, action]) => {
    const overlay = document.createElement('div');
    overlay.className = `swipe-overlay ${action.name}`;
    overlay.dataset.dir = dir;
    overlay.innerHTML = `
      <div class="overlay-label">
        <span>${action.icon}</span>
        <span>${action.label}</span>
      </div>`;
    div.appendChild(overlay);
  });

  div.appendChild(image);
  div.appendChild(labelBar);
  return div;
}

// ── Swipe Gesture Logic ────────────────────────────────────────────────────
function attachSwipeListeners(card) {
  let startX = 0, startY = 0;
  let isDragging = false;

  function onStart(x, y) {
    startX = x;
    startY = y;
    isDragging = true;
    card.style.transition = 'none';
  }

  function onMove(x, y) {
    if (!isDragging) return;
    const dx = x - startX;
    const dy = y - startY;
    const rotation = dx * ROTATION_FACTOR;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rotation}deg)`;
    updateOverlays(card, dx, dy);
  }

  function onEnd(x, y) {
    if (!isDragging) return;
    isDragging = false;

    const dx = x - startX;
    const dy = y - startY;
    const direction = getDirection(dx, dy);

    card.style.transition = '';

    if (direction) {
      commitSwipe(card, direction);
    } else {
      card.classList.add('snap-back');
      card.style.transform = '';
      clearOverlays(card);
      card.addEventListener('animationend', () => {
        card.classList.remove('snap-back');
      }, { once: true });
    }
  }

  // Touch events
  card.addEventListener('touchstart', e => {
    const t = e.touches[0];
    onStart(t.clientX, t.clientY);
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    const t = e.touches[0];
    onMove(t.clientX, t.clientY);
    e.preventDefault(); // prevent page scroll while swiping
  }, { passive: false });

  card.addEventListener('touchend', e => {
    const t = e.changedTouches[0];
    onEnd(t.clientX, t.clientY);
  });

  // Mouse events
  card.addEventListener('mousedown', e => {
    onStart(e.clientX, e.clientY);

    function onMouseMove(e) { onMove(e.clientX, e.clientY); }
    function onMouseUp(e) {
      onEnd(e.clientX, e.clientY);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function getDirection(dx, dy) {
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx < SWIPE_THRESHOLD && absDy < SWIPE_THRESHOLD) return null;

  if (absDx >= absDy) {
    return dx > 0 ? 'right' : 'left';
  } else {
    return dy < 0 ? 'up' : 'down';
  }
}

function updateOverlays(card, dx, dy) {
  const direction = getDirection(dx, dy);
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const distance = Math.max(absDx, absDy);
  const opacity = Math.min((distance / SWIPE_THRESHOLD) * 0.9, 0.9);

  card.querySelectorAll('.swipe-overlay').forEach(overlay => {
    overlay.style.opacity = overlay.dataset.dir === direction ? opacity : 0;
  });
}

function clearOverlays(card) {
  card.querySelectorAll('.swipe-overlay').forEach(o => (o.style.opacity = 0));
}

// ── Committing a Swipe ─────────────────────────────────────────────────────
function commitSwipe(card, direction) {
  const id = card.dataset.id;
  const action = ACTIONS[direction].name;
  const flyClass = `fly-${direction}`;

  // Show overlay at full opacity
  card.querySelectorAll('.swipe-overlay').forEach(overlay => {
    overlay.style.opacity = overlay.dataset.dir === direction ? 0.9 : 0;
  });

  card.classList.add(flyClass);
  card.addEventListener('animationend', () => {
    card.remove();
    recordAction(id, action);
    state.queue = state.queue.filter(qid => qid !== id);
    renderStack();
    updateProgress();
    updateCatalogueCount();
  }, { once: true });
}

function recordAction(id, action) {
  const img = state.images.find(i => i.id === id);
  if (!img) return;
  // Remove previous entry for this image if re-processed
  state.catalogue = state.catalogue.filter(e => e.id !== id);
  state.catalogue.push({ ...img, action, timestamp: new Date().toISOString() });
}

// ── Keyboard-triggered action ──────────────────────────────────────────────
function triggerAction(direction) {
  const topCard = cardStack.lastElementChild;
  if (!topCard) return;

  // Animate in the overlay briefly then fly
  const overlay = topCard.querySelector(`.swipe-overlay[data-dir="${direction}"]`);
  if (overlay) overlay.style.opacity = 0.9;

  commitSwipe(topCard, direction);
}

// ── UI Updates ─────────────────────────────────────────────────────────────
function updateEmptyState() {
  const hasQueue = state.queue.length > 0;
  const hasImages = state.images.length > 0;

  noImagesState.classList.toggle('hidden', hasImages);
  emptyState.classList.toggle('hidden', !hasImages || hasQueue);
  cardArea.querySelector('#card-stack').style.display = hasQueue ? '' : 'none';
  progressContainer.classList.toggle('hidden', !hasImages);
}

function updateProgress() {
  const total = state.images.length;
  const done  = state.catalogue.length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  progressBar.style.setProperty('--progress', `${pct}%`);
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
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  const items = filter === 'all'
    ? state.catalogue
    : state.catalogue.filter(e => e.action === filter);

  catalogueEmpty.classList.toggle('hidden', items.length > 0);
  catalogueGrid.innerHTML = '';

  items.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'catalogue-item';

    const img = document.createElement('img');
    img.src = entry.src;
    img.alt = entry.name;

    const badge = document.createElement('div');
    badge.className = `catalogue-item-badge ${entry.action}`;
    badge.textContent = ACTIONS[actionToDir(entry.action)]?.icon ?? '?';

    const name = document.createElement('div');
    name.className = 'catalogue-item-name';
    name.textContent = entry.name;

    div.appendChild(img);
    div.appendChild(badge);
    div.appendChild(name);
    catalogueGrid.appendChild(div);
  });
}

function actionToDir(action) {
  return Object.keys(ACTIONS).find(d => ACTIONS[d].name === action);
}

// ── Export ─────────────────────────────────────────────────────────────────
function exportCatalogue() {
  const data = state.catalogue.map(({ id, name, action, timestamp }) => ({
    id, name, action, timestamp,
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `catalogue-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Event Listeners ────────────────────────────────────────────────────────

// File input
fileInput.addEventListener('change', e => loadFiles(e.target.files));

document.getElementById('btn-load-images').addEventListener('click', () => fileInput.click());
document.getElementById('btn-load-first').addEventListener('click', () => fileInput.click());

// Catalogue
document.getElementById('btn-view-catalogue').addEventListener('click', openCatalogue);
document.getElementById('btn-close-modal').addEventListener('click', closeCatalogue);
modalOverlay.addEventListener('click', closeCatalogue);

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => renderCatalogueGrid(btn.dataset.filter));
});

// Export
document.getElementById('btn-export').addEventListener('click', exportCatalogue);

// Reset
document.getElementById('btn-reset').addEventListener('click', () => {
  state.queue = state.images.map(i => i.id);
  state.catalogue = [];
  renderStack();
  updateProgress();
  updateCatalogueCount();
});

// Action buttons (keyboard-style)
document.querySelectorAll('.action-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    const dir = actionToDir(action);
    if (dir) triggerAction(dir);
  });
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (catalogueModal && !catalogueModal.classList.contains('hidden')) return;
  switch (e.key) {
    case 'ArrowLeft':  triggerAction('left');  break;
    case 'ArrowRight': triggerAction('right'); break;
    case 'ArrowUp':    triggerAction('up');    break;
    case 'ArrowDown':  triggerAction('down');  break;
  }
});

// Drag & drop onto card area
cardArea.addEventListener('dragover', e => {
  e.preventDefault();
  cardArea.classList.add('drag-over');
});
cardArea.addEventListener('dragleave', () => cardArea.classList.remove('drag-over'));
cardArea.addEventListener('drop', e => {
  e.preventDefault();
  cardArea.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (files.length) loadFiles(files);
});

// ── Init ───────────────────────────────────────────────────────────────────
updateEmptyState();
updateCatalogueCount();
