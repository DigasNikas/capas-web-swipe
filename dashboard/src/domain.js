// Club and paper display names shared by the dashboard's pages. Colours stay
// in each page's CSS.
export const CLUB_IDS = Object.freeze(['sporting', 'porto', 'benfica', 'others']);
export const CLUB_NAMES = Object.freeze({ sporting: 'Sporting', porto: 'Porto', benfica: 'Benfica', others: 'Restantes' });
export const CLUB_SHORT = Object.freeze({ sporting: 'SCP', porto: 'FCP', benfica: 'SLB', others: 'RES' });
export const COMPETITION_NAMES = Object.freeze({
  PPL: 'Primeira Liga', CL: 'Champions League', EL: 'Liga Europa',
  UECL: 'Liga Conferência', TP: 'Taça de Portugal', TL: 'Taça da Liga',
});
// Europe, biggest competition first: that is the frame a night earns when a
// club played in two (Wednesday's Champions League over Thursday's Europa).
const EURO_ORDER = Object.freeze(['CL', 'EL', 'UECL']);

// Which European competition was played, from one day's matches, or null.
export function euroCompetition(played) {
  return EURO_ORDER.find(code => played.some(m => m.competition === code)) ?? null;
}

export const PAPER_NAMES = Object.freeze({ abola: 'A Bola', ojogo: 'O Jogo', record: 'Record' });
