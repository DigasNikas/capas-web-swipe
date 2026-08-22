import { state } from './state.js';
import {
  cardStack, emptyState, dateHeader, dateLabel, dateProgress,
  progressBar, progressText, progressContainer, calSection,
  activeCardArea,
} from './dom.js';
import { formatDate } from './dates.js';
import { renderCalendar } from './calendar.js';

export function updateEmptyState() {
  const hasQueue = state.queue.length > 0;
  cardStack.style.display = hasQueue ? '' : 'none';
  emptyState.classList.toggle('hidden', hasQueue);
  dateHeader.classList.toggle('hidden', !hasQueue);
  progressContainer.classList.toggle('hidden', state.images.length === 0);
  calSection.classList.toggle('hidden', state.images.length === 0);
  if (!hasQueue) activeCardArea.classList.add('hidden');
}

export function updateDateHeader() {
  const group = state.dateGroups[state.groupIndex];
  if (!group) return;
  dateLabel.textContent = formatDate(group.date);
  if (state.presentationMode) {
    dateProgress.textContent = 'tap to start';
    dateProgress.classList.add('hint');
  } else {
    const total   = group.ids.length;
    const current = total - state.queue.length + 1;
    dateProgress.textContent = `${current} / ${total}`;
    dateProgress.classList.remove('hint');
  }
}

export function updateProgress() {
  const total    = state.dateGroups.length;
  const savedIds = new Set(state.catalogue.map(e => e.id));
  const done     = state.dateGroups.filter(g => g.ids.every(id => savedIds.has(id))).length;
  progressBar.style.setProperty('--progress', `${total ? Math.round((done / total) * 100) : 0}%`);
  progressText.textContent = `${done} / ${total} days`;
  renderCalendar();
}
