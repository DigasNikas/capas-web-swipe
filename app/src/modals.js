import { modalOverlay, instrucoesModal, coverModal, coverModalImg } from './dom.js';

export function animateModalClose(modal, onDone) {
  const content = modal.querySelector('.modal-content');
  if (!content) { onDone(); return; }
  content.style.animation = 'slide-down 0.28s cubic-bezier(0.32, 0.72, 0, 1) forwards';
  setTimeout(() => {
    content.style.animation = '';
    onDone();
  }, 280);
}

export function addSwipeDownToClose(modal, closeFn) {
  const content = modal.querySelector('.modal-content');
  let startY = 0, dragging = false;

  content.addEventListener('touchstart', e => {
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

// Fullscreen cover viewer — same pattern as dashboard/dashboard.js's own
// openCoverModal/closeCoverModal. Sits above the account modal (higher
// z-index), so it's a standalone overlay, not tied to modalOverlay/.modal.
export function openCoverModal(url, name) {
  coverModalImg.src = url;
  coverModalImg.alt = name;
  coverModal.classList.remove('hidden');
}

export function closeCoverModal() {
  coverModal.classList.add('hidden');
  coverModalImg.src = '';
}
