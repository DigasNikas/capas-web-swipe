import { state } from './state.js';
import { calMonthLabel, calGrid } from './dom.js';
import { formatDate } from './dates.js';

const CAL_HEADERS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

let calViewYear  = new Date().getFullYear();
let calViewMonth = new Date().getMonth();
let _onDateClick = null;

export function setDateClickHandler(fn) { _onDateClick = fn; }

export function syncCalToActiveDate() {
  const d = state.dateGroups[state.groupIndex]?.date;
  if (d) { calViewYear = +d.slice(0, 4); calViewMonth = +d.slice(5, 7) - 1; }
}

export function renderCalendar() {
  const savedIds       = new Set(state.catalogue.map(e => e.id));
  const completedDates = new Set(
    state.dateGroups.filter(g => g.ids.every(id => savedIds.has(id))).map(g => g.date)
  );
  const activeDate  = state.dateGroups[state.groupIndex]?.date;
  const allDates    = new Set(state.dateGroups.map(g => g.date));

  calMonthLabel.textContent = new Date(calViewYear, calViewMonth, 1)
    .toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

  const offset      = (new Date(calViewYear, calViewMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

  calGrid.innerHTML = '';

  CAL_HEADERS.forEach(h => {
    const el = document.createElement('div');
    el.className = 'cal-day-header';
    el.textContent = h;
    calGrid.appendChild(el);
  });

  for (let i = 0; i < offset; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    calGrid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${calViewYear}-${String(calViewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const el = document.createElement('div');
    el.className = 'cal-day';
    if      (completedDates.has(ds)) el.classList.add('completed');
    else if (ds === activeDate)      el.classList.add('active');
    else if (allDates.has(ds))       el.classList.add('pending');
    el.textContent = d;

    if (allDates.has(ds)) {
      el.classList.add('has-data');
      if (_onDateClick) {
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', formatDate(ds));
        el.addEventListener('click', () => _onDateClick(ds));
        el.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onDateClick(ds); }
        });
      }
    }
    calGrid.appendChild(el);
  }
}

export function prevMonth() {
  calViewMonth--;
  if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
  renderCalendar();
}

export function nextMonth() {
  calViewMonth++;
  if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
  renderCalendar();
}
