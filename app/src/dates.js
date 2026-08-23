export function groupByDate(images) {
  const map = new Map();
  for (const img of images) {
    if (!map.has(img.date)) map.set(img.date, []);
    map.get(img.date).push(img.id);
  }
  return [...map.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map(date => ({ date, ids: map.get(date) }));
}

export function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-PT', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function formatMonth(key) {
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
}

export function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${new Intl.DateTimeFormat('pt-PT', { month: 'short' }).format(d)}`;
}

export function groupByMonth(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.date.slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map(key => ({ key, label: formatMonth(key), items: map.get(key) }));
}
