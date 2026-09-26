export function resetTableFilters(params: URLSearchParams) {
  const next = new URLSearchParams(params);
  ['q', 'categories', 'countries', 'from', 'to', 'min', 'max', 'page'].forEach((key) => next.delete(key));
  next.set('mode', 'all');
  return next;
}
