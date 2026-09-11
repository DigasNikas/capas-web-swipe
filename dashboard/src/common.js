// Dashboard-wide values and helpers used by more than one section.
import { CLUB_IDS, CLUB_NAMES, CLUB_SHORT } from '/src/domain.js';

export const API_URL = '/api';

export const CLUB_META = Object.fromEntries(CLUB_IDS.map(id => [id, {
  name: CLUB_NAMES[id], short: CLUB_SHORT[id], color: `var(--d-${id})`,
}]));

export const MONTHS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

// "A Bola", "A Bola e Record", "A Bola, O Jogo e Record" — every separator a
// comma except the last, which is "e". Plain join(' e ') only reads right up
// to two items; three or more chains "e" between every pair instead.
export function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}
