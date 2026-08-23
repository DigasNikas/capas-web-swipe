import { ACTIONS, API_URL } from './state.js';
import { formatMonth, formatShortDate, groupByMonth } from './dates.js';
import { openCoverModal } from './modals.js';

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
    img.addEventListener('click', () => openCoverModal(entry.full, entry.name));

    const badge = document.createElement('div');
    badge.className = `catalogue-item-badge ${entry.action}`;
    badge.textContent = ACTIONS[actionToDir(entry.action)]?.icon ?? '?';

    const star = document.createElement('button');
    star.className = `catalogue-item-star${entry.starred ? ' active' : ''}`;
    star.textContent = entry.starred ? '★' : '☆';
    star.setAttribute('aria-label', 'Favorito');
    star.addEventListener('click', e => {
      e.stopPropagation();
      toggleFavorite(entry, star);
    });

    const footer = document.createElement('div');
    footer.className = 'catalogue-item-footer';

    const date = document.createElement('div');
    date.className = 'catalogue-item-date';
    date.textContent = formatShortDate(entry.date);

    const name = document.createElement('div');
    name.className = 'catalogue-item-name';
    name.textContent = entry.name;

    footer.append(date, name);
    div.append(img, badge, star, footer);
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
