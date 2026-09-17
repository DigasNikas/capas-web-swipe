// "Posse de bola dividida": the covers the crowd split over, most divided
// first. /api/stats does the selecting (see dividedCovers in stats.js); this
// only draws it.
//
// No imports, so `divided.test.mjs` can run the pure parts in plain node —
// same reason as pulse.js. Anything it needs from elsewhere (club names, the
// lightbox) arrives as an argument.
const CLUB_ORDER = ['benfica', 'sporting', 'porto', 'others'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Two rows are always visible and the rest sit behind the button: the section
// has to show what it is about before anyone presses anything.
export const ALWAYS_VISIBLE = 2;

export function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function winnerShare(cover) {
  return Math.round((100 * cover.votes_club) / cover.votes_total);
}

// Only the clubs that actually got a vote, in a fixed order so the same cover
// always draws the same bar.
export function segments(cover) {
  return CLUB_ORDER
    .filter(club => cover.votes[club] > 0)
    .map(club => ({ club, votes: cover.votes[club], pct: (100 * cover.votes[club]) / cover.votes_total }));
}

export function renderDivided(divided, { clubNames, onOpenCover }) {
  const section = document.getElementById('dividida');
  const list = document.getElementById('dividida-rows');
  const button = document.getElementById('btn-dividida');
  if (!divided || divided.length === 0) return;

  list.innerHTML = '';
  divided.forEach((cover, i) => list.appendChild(row(cover, i, { clubNames, onOpenCover })));
  section.classList.remove('hidden');

  const extras = [...list.querySelectorAll('.d-dividida-row')].slice(ALWAYS_VISIBLE);
  button.hidden = extras.length === 0;
  if (button.hidden) return;

  const label = () => (extras[0].hidden ? 'Ver restantes' : 'Esconder');
  button.textContent = label();
  button.onclick = () => {
    const show = extras[0].hidden;
    extras.forEach(el => { el.hidden = !show; });
    button.setAttribute('aria-expanded', String(show));
    button.textContent = label();
  };
}

// textContent for everything the newspaper wrote — the paper names are ours,
// but a headline never is.
function row(cover, index, { clubNames, onOpenCover }) {
  const li = document.createElement('li');
  li.className = 'd-dividida-row';
  li.hidden = index >= ALWAYS_VISIBLE;

  const thumb = document.createElement('button');
  thumb.type = 'button';
  thumb.className = 'd-dividida-thumb';
  thumb.setAttribute('aria-label', `Abrir a capa do ${cover.name} de ${shortDate(cover.date)}`);
  const img = document.createElement('img');
  img.src = cover.thumb_url;
  img.alt = `Capa do ${cover.name} de ${shortDate(cover.date)}`;
  img.loading = 'lazy';
  thumb.appendChild(img);
  thumb.addEventListener('click', () => onOpenCover(cover.url, cover.name));

  const body = document.createElement('div');
  body.className = 'd-dividida-body';

  const head = document.createElement('div');
  head.className = 'd-dividida-head';
  const meta = document.createElement('span');
  meta.className = 'd-dividida-meta';
  meta.textContent = `${cover.name} · ${shortDate(cover.date)} · ${cover.votes_total} votos`;
  const share = document.createElement('span');
  share.className = `d-dividida-share d-club-${cover.club}`;
  share.textContent = `${winnerShare(cover)}% ${clubNames[cover.club]}`;
  head.append(meta, share);

  const bar = document.createElement('div');
  bar.className = 'd-dividida-bar';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label',
    `${winnerShare(cover)}% para ${clubNames[cover.club]}, em ${cover.votes_total} votos`);

  const legend = document.createElement('ul');
  legend.className = 'd-dividida-legend';

  segments(cover).forEach(seg => {
    const span = document.createElement('span');
    span.className = `d-dividida-seg d-bg-${seg.club}`;
    span.style.width = `${seg.pct}%`;
    bar.appendChild(span);

    const item = document.createElement('li');
    const swatch = document.createElement('i');
    swatch.className = `d-bg-${seg.club}`;
    const count = document.createElement('b');
    count.textContent = seg.votes;
    item.append(swatch, document.createTextNode(`${clubNames[seg.club]} `), count);
    legend.appendChild(item);
  });

  body.append(head, bar, legend);
  li.append(thumb, body);
  return li;
}
