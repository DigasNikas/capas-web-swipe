import { API_URL } from '/src/common.js';

/* ── Comentários ─────────────────────────────────────────────────────────
   Only ever attached to the newest cover day. Google sign-in is the only
   gate — no accounts, no profiles, nothing that outlives the day.        */

// Public OAuth client ID (same Google client as the Cloudflare Access IdP).
// Requires https://capas.digasnikas.com in its Authorized JavaScript origins.
const GOOGLE_CLIENT_ID = '107331929504-16jvt0ml8gago9iofrd2sqtg1barsob6.apps.googleusercontent.com';
const SESSION_KEY = 'capas_gid';

// The raw Google ID token. sessionStorage, not localStorage: it dies with
// the tab, which matches how long a comment lives anyway.
let session = sessionStorage.getItem(SESSION_KEY);

export async function initComments() {
  // Its own section since the AI card moved in between — used to be nested
  // inside #latest, which is what hid it until there was a day to talk about.
  document.getElementById('conversa').classList.remove('hidden');

  const res = await fetch(`${API_URL}/comments`);
  if (!res.ok) return;
  const { comments } = await res.json();

  renderComments(comments);
  renderCommentAuth();
  document.getElementById('comments-form').addEventListener('submit', submitComment);
}

function renderComments(list) {
  const el = document.getElementById('comments-list');
  el.innerHTML = '';
  list.forEach(c => el.appendChild(commentEl(c)));
}

// textContent only — this is the one place on the page rendering text a
// stranger wrote. Do not switch it to innerHTML to match the rest of the file.
function commentEl(c) {
  const row = document.createElement('article');
  row.className = 'd-comment';

  const who = document.createElement('span');
  who.className = 'd-comment-who';
  who.textContent = c.author;

  const when = document.createElement('span');
  when.className = 'd-comment-when';
  when.textContent = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit' })
    .format(new Date(c.created_at.replace(' ', 'T') + 'Z'));

  const meta = document.createElement('div');
  meta.className = 'd-comment-meta';
  meta.append(who, when);

  const body = document.createElement('p');
  body.className = 'd-comment-body';
  body.textContent = c.body;

  row.append(meta, body);
  return row;
}

// Also flips the textarea itself between disabled/writable and shows/hides
// #comment-gate over it — signed out, the box is blocked outright rather
// than just sitting there disabled underneath a prompt below it.
function renderCommentAuth() {
  const el     = document.getElementById('comment-auth');
  const gate   = document.getElementById('comment-gate');
  const bodyEl = document.getElementById('comment-body');
  el.innerHTML = '';

  if (session) {
    gate.classList.add('hidden');
    bodyEl.disabled = false;

    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'd-cta d-cta-small';
    send.textContent = 'Comentar →';

    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'd-comments-signout';
    out.textContent = 'sair';
    out.addEventListener('click', () => { setSession(null); renderCommentAuth(); });

    el.append(send, out);
    return;
  }

  gate.classList.remove('hidden');
  bodyEl.disabled = true;

  const slot = document.getElementById('comment-gate-btn');
  slot.innerHTML = '';
  whenGis(() => {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
    google.accounts.id.renderButton(slot, {
      theme: 'filled_black', size: 'medium', shape: 'pill', text: 'signin_with', locale: 'pt-PT',
    });
  });
}

// The GIS script is async, so it may land before or after this module runs.
function whenGis(cb) {
  if (window.google?.accounts?.id) return cb();
  document.getElementById('gsi').addEventListener('load', cb, { once: true });
}

function onGoogleCredential(response) {
  setSession(response.credential);
  renderCommentAuth();
  document.getElementById('comment-body').focus();
}

function setSession(token) {
  session = token;
  if (token) sessionStorage.setItem(SESSION_KEY, token);
  else sessionStorage.removeItem(SESSION_KEY);
}

async function submitComment(e) {
  e.preventDefault();
  const bodyEl = document.getElementById('comment-body');
  const errEl  = document.getElementById('comment-error');
  const btn    = e.target.querySelector('button[type="submit"]');
  const body   = bodyEl.value.trim();
  if (!body || !session || !btn) return;

  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'A enviar…';

  let res, data;
  try {
    res = await fetch(`${API_URL}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: session, body }),
    });
    data = await res.json();
  } catch {
    errEl.textContent = 'Sem ligação. Tenta outra vez.';
    btn.disabled = false;
    btn.textContent = 'Comentar →';
    return;
  }

  if (!res.ok) {
    errEl.textContent = data?.error || 'Não foi possível enviar.';
    // The Google ID token lasts an hour; past that, sign in again.
    if (res.status === 401) setSession(null);
    renderCommentAuth();
    return;
  }

  bodyEl.value = '';
  document.getElementById('comments-list').appendChild(commentEl(data));
  renderCommentAuth();
}
