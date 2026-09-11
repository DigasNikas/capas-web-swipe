import { PAPER_NAMES } from '/src/domain.js';

const coverageEl = document.getElementById('coverage');
const statusEl   = document.getElementById('status');
const resultsEl  = document.getElementById('results');
const qEl        = document.getElementById('q');

let debounceTimer = null;
qEl.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => search(qEl.value), 300);
});

search('');

// One cover's RAG matches, fetched when its modal opens. Covers the AI
// Detector never classified with RAG context have none; the strip stays hidden.
async function loadSimilar(id) {
  try {
    const res = await fetch(`/api/similarities?id=${id}`);
    const [entry] = res.ok ? await res.json() : [];
    return entry?.ragCovers ?? [];
  } catch {
    return [];
  }
}

async function search(q) {
  statusEl.textContent = 'A procurar…';
  statusEl.classList.remove('error');

  let res;
  try {
    res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  } catch (err) {
    statusEl.textContent = `Erro de rede: ${err}`;
    statusEl.classList.add('error');
    return;
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error ?? ''; } catch { /* not JSON, no extra detail */ }
    statusEl.textContent = `Erro ${res.status}${detail ? `: ${detail}` : '.'}`;
    statusEl.classList.add('error');
    return;
  }

  const { results, total, searchable } = await res.json();
  const roundedSearchable = Math.floor(searchable / 100) * 100;
  coverageEl.textContent = `Procura em mais de ${roundedSearchable} capas.`;
  statusEl.textContent = q.trim() ? `${results.length} resultado${results.length === 1 ? '' : 's'}.` : '';
  render(results);
}

function render(results) {
  resultsEl.innerHTML = '';
  if (qEl.value.trim() && results.length === 0) {
    resultsEl.innerHTML = '<div class="empty">Nenhum resultado.</div>';
    return;
  }

  results.forEach(r => {
    const div = document.createElement('div');
    div.className = 'result';
    div.tabIndex = 0;
    div.setAttribute('role', 'button');

    const d = new Date(r.date + 'T00:00:00');
    const label = `${PAPER_NAMES[r.newspaper] || r.newspaper} · ${d.toLocaleDateString('pt-PT')}`;
    div.title = `${label}\n${r.headlines}`;

    const img = document.createElement('img');
    img.src = r.thumb_url || r.url;
    img.alt = label;
    img.loading = 'lazy';
    div.appendChild(img);

    const open = () => openModal1(r);
    div.addEventListener('click', open);
    div.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });

    resultsEl.appendChild(div);
  });
}

const modal1 = document.getElementById('modal1');
const modal1Img = document.getElementById('modal1-img');
const similarStrip = document.getElementById('similar-strip');

function openModal1(r) {
  modal1Img.src = r.url;
  modal1Img.alt = PAPER_NAMES[r.newspaper] || r.newspaper;

  similarStrip.innerHTML = '';
  similarStrip.classList.add('hidden');
  modal1.dataset.coverId = r.id;
  modal1.classList.remove('hidden');

  loadSimilar(r.id).then(ragCovers => {
    // Another cover's modal may have opened while this one was loading.
    if (modal1.dataset.coverId !== String(r.id) || !ragCovers.length) return;
    similarStrip.classList.remove('hidden');
    const label = document.createElement('span');
    label.className = 'sim-label';
    label.textContent = 'Parecidas:';
    similarStrip.appendChild(label);

    ragCovers.forEach((rc, i) => {
      const img = document.createElement('img');
      img.src = rc.thumb_url || rc.url;
      img.alt = PAPER_NAMES[rc.newspaper] || rc.newspaper;
      img.loading = 'lazy';
      img.addEventListener('click', () => openModal2(ragCovers, i));
      similarStrip.appendChild(img);
    });
  });
}

function closeModal1() {
  closeModal2();
  modal1.classList.add('hidden');
  modal1Img.src = '';
  similarStrip.innerHTML = '';
  similarStrip.classList.add('hidden');
}

document.getElementById('modal1-close').addEventListener('click', closeModal1);
modal1.addEventListener('click', closeModal1);
modal1Img.addEventListener('click', e => e.stopPropagation());
similarStrip.addEventListener('click', e => e.stopPropagation());

// The carousel over one cover's RAG matches — opened from similar-strip,
// stacked visually above modal1 rather than replacing it. Same
// prev/next-paging shape as the main dashboard's "onde discordam"
// lightbox (dashboard.js's stepDiffModal).
const modal2 = document.getElementById('modal2');
const modal2Img = document.getElementById('modal2-img');
const modal2Prev = document.getElementById('modal2-prev');
const modal2Next = document.getElementById('modal2-next');
let carouselItems = null;
let carouselIndex = 0;

function openModal2(items, index) {
  carouselItems = items;
  carouselIndex = index;
  renderModal2();
  modal2.classList.remove('hidden');
}

function stepModal2(delta) {
  const next = carouselIndex + delta;
  if (!carouselItems || next < 0 || next >= carouselItems.length) return;
  carouselIndex = next;
  renderModal2();
}

function renderModal2() {
  const c = carouselItems[carouselIndex];
  modal2Img.src = c.url;
  modal2Img.alt = PAPER_NAMES[c.newspaper] || c.newspaper;
  modal2Prev.disabled = carouselIndex === 0;
  modal2Next.disabled = carouselIndex === carouselItems.length - 1;
}

function closeModal2() {
  modal2.classList.add('hidden');
  modal2Img.src = '';
  carouselItems = null;
}

document.getElementById('modal2-close').addEventListener('click', closeModal2);
modal2.addEventListener('click', closeModal2);
document.querySelector('#modal2 .cmodal-panel').addEventListener('click', e => e.stopPropagation());
modal2Prev.addEventListener('click', e => { e.stopPropagation(); stepModal2(-1); });
modal2Next.addEventListener('click', e => { e.stopPropagation(); stepModal2(1); });

// Left/right paging through the 5 "parecidas" from the keyboard, not just
// the ‹ › buttons — only while the carousel is actually open.
document.addEventListener('keydown', e => {
  if (modal2.classList.contains('hidden')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepModal2(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); stepModal2(1); }
});

// Escape closes whichever modal is actually on top — modal2 first if
// it's open, so Escape backs out one layer at a time instead of
// skipping straight past the carousel to the grid.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!modal2.classList.contains('hidden')) closeModal2();
  else if (!modal1.classList.contains('hidden')) closeModal1();
});
