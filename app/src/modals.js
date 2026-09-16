import { modalOverlay, instrucoesModal } from './dom.js';

export function animateModalClose(modal, onDone) {
  const content = modal.querySelector('.modal-content');
  if (!content) { onDone(); return; }
  content.style.animation = 'slide-down 0.28s cubic-bezier(0.32, 0.72, 0, 1) forwards';
  setTimeout(() => {
    content.style.animation = '';
    onDone();
  }, 280);
}

// The scrollable element the touch started in, if any. A bottom sheet whose
// body scrolls has to decide, on every touch, whether the gesture belongs to
// the sheet or to the list inside it — otherwise dragging the leaderboard back
// to the top is the same movement that dismisses the modal, and the modal wins.
function scrollerAt(node, root) {
  for (let el = node; el && el !== root.parentElement; el = el.parentElement) {
    const scrollable = el.scrollHeight > el.clientHeight + 1;
    if (scrollable && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
  }
  return null;
}

export function addSwipeDownToClose(modal, closeFn) {
  const content = modal.querySelector('.modal-content');
  let startY = 0, dragging = false;

  content.addEventListener('touchstart', e => {
    // Only drag the sheet when the list under the finger is already at its
    // top, the same rule iOS uses: scrolling up runs to the end of the list
    // first, and only a fresh gesture from there dismisses.
    const scroller = scrollerAt(e.target, content);
    if (scroller && scroller.scrollTop > 0) { dragging = false; return; }

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

export function openInstrucoes() {
  instrucoesModal.classList.remove('hidden');
  modalOverlay.classList.remove('hidden');
}

export function closeInstrucoes() {
  animateModalClose(instrucoesModal, () => {
    instrucoesModal.classList.add('hidden');
    modalOverlay.classList.add('hidden');
  });
}
