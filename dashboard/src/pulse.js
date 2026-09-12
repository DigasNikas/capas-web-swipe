// The calendar's 🚨 line. No imports on purpose: dashboard/pulse.test.mjs
// runs it in node, where this file's siblings' absolute '/src/…' imports
// wouldn't resolve.

// "A Bola", "A Bola e Record", "A Bola, O Jogo e Record" — every separator a
// comma except the last, which is "e".
function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

// names: the ignored clubs, already as display names.
// onlyOne: nobody else played that day, which is what makes it unfair.
// competition: display name, or null for matches imported before the column.
export function pulseMessage(names, { onlyOne, competition }) {
  const who = joinNames(names);
  if (onlyOne) {
    const what = competition ? `jogar ${competition}` : 'jogar';
    return `${who} foi o único a ${what} ontem e não foi mencionado por todos`;
  }
  return names.length === 1
    ? `${who} jogou ontem e não foi mencionado por todos`
    : `${who} jogaram ontem e não foram mencionados por todos`;
}
