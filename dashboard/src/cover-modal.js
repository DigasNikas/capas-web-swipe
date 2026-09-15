// The cover lightbox: one fixed image, or paging through the AI diffs.
import { PAPER_NAMES } from '/src/domain.js';
import { CLUB_META, MONTHS } from '/src/common.js';

export function openCoverModal(url, name) {
  diffModalItems = null;
  document.getElementById('cover-modal-img').src = url;
  document.getElementById('cover-modal-img').alt = name;
  document.getElementById('cover-modal-meta').classList.add('hidden');
  document.getElementById('cover-modal-prev').classList.add('hidden');
  document.getElementById('cover-modal-next').classList.add('hidden');
  document.getElementById('cover-modal').classList.remove('hidden', 'd-cover-modal--paging');
}

// The "onde discordam" lightbox: same modal, but paging through `items`
// (the currently open month's covers) instead of showing one fixed image,
// plus the verdict/headline/why that plain cover clicks elsewhere never need.
let diffModalItems = null;
let diffModalIndex = 0;

export function openAiDiffModal(items, index) {
  diffModalItems = items;
  diffModalIndex = index;
  document.getElementById('cover-modal').classList.add('d-cover-modal--paging');
  document.getElementById('cover-modal').classList.remove('hidden');
  renderDiffModal();
}

function stepDiffModal(delta) {
  if (!diffModalItems) return;
  const next = diffModalIndex + delta;
  if (next < 0 || next >= diffModalItems.length) return;
  diffModalIndex = next;
  renderDiffModal();
}

function renderDiffModal() {
  const r = diffModalItems[diffModalIndex];
  const paper = PAPER_NAMES[r.newspaper];

  const img = document.getElementById('cover-modal-img');
  img.src = r.url;
  img.alt = paper;

  document.getElementById('cover-modal-prev').classList.remove('hidden');
  document.getElementById('cover-modal-prev').disabled = diffModalIndex === 0;
  document.getElementById('cover-modal-next').classList.remove('hidden');
  document.getElementById('cover-modal-next').disabled = diffModalIndex === diffModalItems.length - 1;

  // textContent throughout — headline/why are copied verbatim off a
  // newspaper page by the model, not text this codebase controls.
  const meta = document.getElementById('cover-modal-meta');
  meta.classList.remove('hidden');
  meta.innerHTML = '';

  const date = document.createElement('div');
  date.className = 'cm-date';
  const d = new Date(r.date + 'T00:00:00');
  date.textContent = `${paper} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  meta.append(date);

  const result = document.createElement('div');
  result.className = 'cm-result';
  const side = (tag, k) => {
    const el = document.createElement('span');
    el.className = 'cm-tag';
    el.style.background = CLUB_META[k].color;
    const i = document.createElement('i');
    i.textContent = tag;
    el.append(i, document.createTextNode(CLUB_META[k].short));
    return el;
  };
  result.append(side('AI', r.club), side('VOTO', r.human_club));
  meta.append(result);

  if (r.headline) {
    const headline = document.createElement('div');
    headline.className = 'cm-headline';
    headline.textContent = `"${r.headline.replace(/^["']+|["']+$/g, '')}"`;
    meta.append(headline);
  }

  // Most of the archive was classified before the prompt asked for this.
  if (r.why) {
    const why = document.createElement('div');
    why.className = 'cm-why';
    why.textContent = `→ ${r.why}`;
    meta.append(why);
  }
}

function closeCoverModal() {
  document.getElementById('cover-modal').classList.add('hidden');
  document.getElementById('cover-modal').classList.remove('d-cover-modal--paging');
  document.getElementById('cover-modal-img').src = '';
  document.getElementById('cover-modal-meta').classList.add('hidden');
  document.getElementById('cover-modal-meta').innerHTML = '';
  document.getElementById('cover-modal-prev').classList.add('hidden');
  document.getElementById('cover-modal-next').classList.add('hidden');
  diffModalItems = null;
}

document.getElementById('cover-modal').addEventListener('click', closeCoverModal);
document.getElementById('cover-modal-close').addEventListener('click', closeCoverModal);
document.getElementById('cover-modal-meta').addEventListener('click', e => e.stopPropagation());
document.getElementById('cover-modal-prev').addEventListener('click', e => { e.stopPropagation(); stepDiffModal(-1); });
document.getElementById('cover-modal-next').addEventListener('click', e => { e.stopPropagation(); stepDiffModal(1); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCoverModal();
  if (e.key === 'ArrowRight') stepDiffModal(1);
  if (e.key === 'ArrowLeft') stepDiffModal(-1);
});
