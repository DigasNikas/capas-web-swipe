// A day's verdict from its covers: which club won, and how many of the day's
// papers agreed. Shared by /stats (the crowd's) and /detector (the model's) so
// the two readouts stay directly comparable — same arithmetic, different key.
export const CLUBS = ["sporting", "benfica", "porto", "others"];

export function verdict(rows, key) {
  const tally = Object.fromEntries(CLUBS.map(c => [c, 0]));
  rows.forEach(r => tally[r[key]]++);
  const winner = CLUBS.reduce((a, b) => (tally[b] > tally[a] ? b : a), CLUBS[0]);
  const winnerVotes = tally[winner];
  return {
    winner,
    hasMajority: winnerVotes > rows.length - winnerVotes,
    confidence: winnerVotes / rows.length,
  };
}
