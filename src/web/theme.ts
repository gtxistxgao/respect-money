import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';
const storageKey = 'respect-money-theme';
const listeners = new Set<() => void>();
let theme: Theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

function apply(next: Theme) {
  theme = next;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f5f7fa' : '#0a0e14');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  for (const listener of listeners) listener();
}
apply(theme);
export function setTheme(next: Theme) {
  try { localStorage.setItem(storageKey, next); } catch { /* Switching still works when browser storage is unavailable. */ }
  apply(next);
}
window.addEventListener('storage', (event) => {
  if (event.key === storageKey || event.key === null) apply(event.newValue === 'light' ? 'light' : 'dark');
});
export function useTheme() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => theme);
}
