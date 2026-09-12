// The calendar's 🚨 line. No imports on purpose: dashboard/pulse.test.mjs
// runs it in node, where this file's siblings' absolute '/src/…' imports
// wouldn't resolve.

// "A Bola", "A Bola e Record", "A Bola, O Jogo e Record" — every separator a
// comma except the last, which is "e".
function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

// "manchete", never "mencionado": all three clubs appear on every front page,
// in the side rails if nowhere else. What the vote records, and what this
// complains about, is which club the page leads with.
//
// names: the ignored clubs, already as display names.
// onlyOne: nobody else played that day, which is what makes it unfair — there
//   the complaint is that a paper led with a club that stayed home, so the bar
//   is every cover.
// competition: display name, or null for matches imported before the column.
//
// On a day several clubs played, snubInfoFor only flags a club that led no
// cover at all, so those sentences say that instead.
export function pulseMessage(names, { onlyOne, competition }) {
  const who = joinNames(names);
  if (onlyOne) {
    const what = competition ? `jogar ${competition}` : 'jogar';
    return `${who} foi o único a ${what} e não foi manchete em todas as capas`;
  }
  return names.length === 1
    ? `${who} jogou e não foi manchete em nenhuma capa`
    : `${who} jogaram e não foram manchete em nenhuma capa`;
}
