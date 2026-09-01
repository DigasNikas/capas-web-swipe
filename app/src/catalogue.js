import { ACTIONS, API_URL } from './state.js';
import { formatDate, formatMonth, formatShortDate, groupByMonth } from './dates.js';
import {
  historicoPanel, btnHistoricoOpen, btnHistoricoBack,
  coverDetailPanel, btnCdpBack, cdpImg, cdpStar, cdpName, cdpDate, cdpDecision,
} from './dom.js';

const catalogueGrid  = document.getElementById('catalogue-grid');
const catalogueEmpty = document.getElementById('catalogue-empty');
const catNav         = document.getElementById('catalogue-nav');
const navLabel        = document.getElementById('catalogue-nav-label');

let catalogue    = [];
let activeFilter = 'all';
let drillLevel   = 0;
let drillMonth   = null;

// 'starred' is a personal bookmark, unrelated to ACTIONS.up.name === 'favorite'
// (that's the "Restantes" swipe decision) — deliberately different words so
// the two concepts never collide in code.
const FILTER_LABELS = { all: 'Tudo', keep: 'Sporting', reject: 'Benfica', skip: 'Porto', favorite: 'Restantes', starred: 'Favoritos' };

// Makes a non-native element (div/img used as a tap target) keyboard-operable:
// focusable, announced as a button, and Enter/Space-activatable.
function makeClickable(el, label, onActivate) {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', label);
  el.addEventListener('click', onActivate);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
  });
}

export function renderCatalogue(items) {
  catalogue  = items;
  drillLevel = 0;
  drillMonth = null;
  renderCatalogueView();
}

export function setActiveFilter(filter) {
  activeFilter = filter;
  drillLevel = 0;
  drillMonth = null;
  renderCatalogueView();
}

export function catalogueBack() {
  drillLevel = Math.max(0, drillLevel - 1);
  if (drillLevel < 2) drillMonth = null;
  renderCatalogueView();
}

function renderCatalogueView() {
  document.querySelectorAll('.filter-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.filter === activeFilter)
  );

  catalogueGrid.innerHTML = '';
  catalogueGrid.classList.remove('grid-view');
  catNav.classList.toggle('hidden', drillLevel === 0);

  const items = activeFilter === 'all'
    ? catalogue
    : activeFilter === 'starred'
      ? catalogue.filter(e => e.starred)
      : catalogue.filter(e => e.action === activeFilter);

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
  makeClickable(bundle, `${items.length} ${items.length === 1 ? 'capa' : 'capas'}, tocar para ver`, onClick);
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
  makeClickable(div, label, onClick);
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
    img.loading = 'lazy';
    card.appendChild(img);
    stack.appendChild(card);
  }

  const countBadge = document.createElement('div');
  countBadge.className = 'bundle-count-badge';
  countBadge.textContent = items.length;
  stack.appendChild(countBadge);

  return stack;
}

function expandGrid(items) {
  catalogueGrid.innerHTML = '';
  catalogueGrid.classList.add('grid-view');
  items.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'catalogue-item';

    const img = document.createElement('img');
    img.src = entry.src; img.alt = entry.name; img.loading = 'lazy';
    makeClickable(img, `Ver capa: ${entry.name}`, () => openCoverDetail(entry));

    // Was a colored circle badge in its own corner — now a color overlay
    // on the footer bar itself instead, so the voted club still reads at
    // a glance without a second element competing with the favorite star
    // (moved to the cover-detail drawer, see openCoverDetail below).
    const footer = document.createElement('div');
    footer.className = 'catalogue-item-footer';
    footer.style.background = `linear-gradient(transparent, var(--${entry.action}))`;

    const date = document.createElement('div');
    date.className = 'catalogue-item-date';
    date.textContent = formatShortDate(entry.date);

    const name = document.createElement('div');
    name.className = 'catalogue-item-name';
    name.textContent = entry.name;

    footer.append(date, name);
    div.append(img, footer);
    catalogueGrid.appendChild(div);
  });
}

// Optimistic toggle — flips immediately, rolls back on request failure.
async function toggleFavorite(entry, star) {
  const next = !entry.starred;
  entry.starred = next;
  star.classList.toggle('active', next);
  star.textContent = next ? '★' : '☆';

  try {
    const res = await fetch(`${API_URL}/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover_id: entry.id, favorite: next }),
    });
    if (!res.ok) throw new Error('request failed');
  } catch {
    entry.starred = !next;
    star.classList.toggle('active', !next);
    star.textContent = !next ? '★' : '☆';
  }
}

function actionToDir(action) {
  return Object.keys(ACTIONS).find(d => ACTIONS[d].name === action);
}

// Histórico's own full-height drawer, opened by Conta's "Ver" button
// instead of sitting inline in it — same shell as user-detail-panel,
// left-anchored. Doesn't need to touch catalogue/filter state: whatever
// renderCatalogueView last drew is still there, this just reveals it.
export function openHistoricoPanel() {
  historicoPanel.classList.remove('hidden');
}

// Mirrors leaderboard.js's closeUserDetail: same drawer-out-left
// animation/timing, since this panel also anchors left.
export function closeHistoricoPanel() {
  if (historicoPanel.classList.contains('hidden')) return;
  const content = historicoPanel.querySelector('.udp-content');
  content.style.animation = 'drawer-out-left 0.28s cubic-bezier(0.32, 0.72, 0, 1) forwards';
  setTimeout(() => {
    content.style.animation = '';
    historicoPanel.classList.add('hidden');
  }, 280);
}

btnHistoricoOpen.addEventListener('click', openHistoricoPanel);
btnHistoricoBack.addEventListener('click', closeHistoricoPanel);

// Own backdrop click-to-close, same pattern as cover-detail-panel below.
historicoPanel.addEventListener('click', e => {
  if (e.target === historicoPanel) closeHistoricoPanel();
});

// Cover detail drawer: opened from within historico-panel above — same
// shell as user-detail-panel/historico-panel, but anchored to the right
// instead of the left, so the two don't cover the same edge. No fetch
// needed here: everything shown already lives on entry, unlike the
// leaderboard drawer's user stats.
function openCoverDetail(entry) {
  coverDetailPanel.classList.remove('hidden');
  cdpImg.src = entry.full;
  cdpImg.alt = entry.name;
  cdpName.textContent = entry.name;
  cdpDate.textContent = formatDate(entry.date);
  const dir = actionToDir(entry.action);
  cdpDecision.textContent = ACTIONS[dir]?.label ?? entry.action;
  cdpDecision.style.background = `var(--${entry.action})`;

  // The favorite toggle lives here now, not on the grid tile — one
  // static button, re-bound to whichever entry is currently open rather
  // than recreated per tile.
  cdpStar.classList.toggle('active', entry.starred);
  cdpStar.textContent = entry.starred ? '★' : '☆';
  cdpStar.onclick = () => toggleFavorite(entry, cdpStar);
}

// Mirrors leaderboard.js's closeUserDetail: same timing/easing, mirrored
// (drawer-out-right) since this panel slides in from the right.
function closeCoverDetail() {
  if (coverDetailPanel.classList.contains('hidden')) return;
  const content = coverDetailPanel.querySelector('.udp-content');
  content.style.animation = 'drawer-out-right 0.28s cubic-bezier(0.32, 0.72, 0, 1) forwards';
  setTimeout(() => {
    content.style.animation = '';
    coverDetailPanel.classList.add('hidden');
  }, 280);
}

btnCdpBack.addEventListener('click', closeCoverDetail);

// Own backdrop click-to-close, guarded to the panel itself so a click on
// the back button doesn't also close it (it's a descendant, so it'd
// otherwise bubble up here too).
coverDetailPanel.addEventListener('click', e => {
  if (e.target === coverDetailPanel) closeCoverDetail();
});

export { closeCoverDetail };
