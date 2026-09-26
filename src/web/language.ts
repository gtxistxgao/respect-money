import { useSyncExternalStore } from 'react';
import { getLocale, setRuntimeLocale, type Locale } from '../i18n/index.js';

const storageKey = 'respect-money-language';
const listeners = new Set<() => void>();
function apply(locale: Locale) {
  setRuntimeLocale(locale);
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  for (const listener of listeners) listener();
}
let initial: Locale = 'zh';
try { if (localStorage.getItem(storageKey) === 'en') initial = 'en'; } catch { /* Private browsers can still switch language in memory. */ }
apply(initial);
export function setLanguage(locale: Locale) {
  try { localStorage.setItem(storageKey, locale); } catch { /* Keep the setting for this session if browser storage is unavailable. */ }
  apply(locale);
}
window.addEventListener('storage', (event) => {
  if (event.key === storageKey || event.key === null) apply(event.newValue === 'en' ? 'en' : 'zh');
});
export function useLanguage() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLocale); }
