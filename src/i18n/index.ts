import en from './en.json' with { type: 'json' };
import zh from './zh.json' with { type: 'json' };

export type Locale = 'en' | 'zh';
export type TranslationKey = keyof typeof en;
export type MessageParams = Record<string, string | number | null | undefined>;
export const catalogs: Record<Locale, Record<string, string>> = { en, zh };
let currentLocale: Locale = 'en';
export const getLocale = () => currentLocale;
export const setRuntimeLocale = (locale: Locale) => { currentLocale = locale; };
export const intlLocale = () => currentLocale === 'zh' ? 'zh-CN' : 'en-US';

export function resolveLocale(header?: string): Locale {
  const preferences = (header || '').split(',').map((part) => {
    const [tag, ...options] = part.trim().toLowerCase().split(';');
    const weight = options.find((option) => option.trim().startsWith('q='));
    return { tag, quality: weight ? Number(weight.trim().slice(2)) : 1 };
  }).filter((item) => item.quality > 0 && item.quality <= 1).sort((a, b) => b.quality - a.quality);
  for (const { tag } of preferences) {
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh';
    if (tag === 'en' || tag.startsWith('en-') || tag === '*') return 'en';
  }
  return 'en';
}
export function translate(locale: Locale, key: string, params: MessageParams = {}): string {
  const template = Object.hasOwn(catalogs[locale], key) ? catalogs[locale][key] : Object.hasOwn(en, key) ? catalogs.en[key] : key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => params[name] === undefined ? placeholder : String(params[name]));
}
export const t = (key: string, params?: MessageParams) => translate(currentLocale, key, params);
export const translateEnglish = (key: string, params?: MessageParams) => translate('en', key, params);

// Durable server messages retain their key and arguments, independent of the
// requesting browser. Existing string columns can store these without migration.
const prefix = '@i18n:';
export function message(key: TranslationKey, params: MessageParams = {}) { return prefix + JSON.stringify({ key, params }); }
export function isMessage(value: string) { return value.startsWith(prefix); }
const legacyTemplates = Object.entries(zh).filter(([key, value]) => key.includes('{p') && value.includes('{p')).map(([key, template]) => {
  const names: string[] = [];
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(p\d+)\\\}/g, (_match, name: string) => { names.push(name); return '([\\s\\S]*?)'; });
  return { key, names, pattern: new RegExp(`^${escaped}$`) };
});
const nestedLegacyMessages = new Set(['{p0}: {p1}', '{p0}: Bank refresh did not complete. Reading existing transactions. {p1}', '{p0}: Investment refresh did not complete. Reading existing transactions. {p1}']);
const legacyLiterals = new Map(Object.entries(zh).map(([key, value]) => [value, key]));
export function renderMessage(value: string, locale: Locale, depth = 0): string {
  if (depth > 8) return translate(locale, 'The operation could not be completed. Please try again.');
  if (isMessage(value)) {
    try {
      const { key, params } = JSON.parse(value.slice(prefix.length)) as { key: string; params: MessageParams };
      if (!Object.hasOwn(en, key) || !params || typeof params !== 'object') return translate(locale, 'The operation could not be completed. Please try again.');
      return translate(locale, key, Object.fromEntries(Object.entries(params).map(([name, part]) => [name, typeof part === 'string' && isMessage(part) ? renderMessage(part, locale, depth + 1) : part])));
    } catch { return translate(locale, 'The operation could not be completed. Please try again.'); }
  }
  // Compatibility for fixed messages saved by older releases. User descriptions,
  // account names and notes never pass through this function on the server.
  const key = legacyLiterals.get(value);
  if (key) return translate(locale, key);
  if (Object.hasOwn(en, value)) return translate(locale, value);
  for (const template of legacyTemplates) {
    const match = value.match(template.pattern);
    if (match) return translate(locale, template.key, Object.fromEntries(template.names.map((name, index) => [name, name === 'p1' && nestedLegacyMessages.has(template.key) ? renderMessage(match[index + 1], locale, depth + 1) : match[index + 1]])));
  }
  return value;
}
export class LocalizedError extends Error {
  constructor(readonly localizedMessage: string, options?: ErrorOptions) { super(renderMessage(localizedMessage, 'en'), options); }
}

export function formatMonth(month: string, locale = getLocale()) {
  const date = new Date(`${month}-01T12:00:00Z`);
  return translate(locale, 'month.heading', { year: month.slice(0, 4), month: locale === 'zh' ? Number(month.slice(5)) : new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date) });
}
export function shortMonth(month: string, locale = getLocale()) {
  return translate(locale, 'month.short', { month: locale === 'zh' ? Number(month.slice(5)) : new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`)) });
}
export function transactionCount(count: number, locale = getLocale()) { return translate(locale, count === 1 ? 'transactions.one' : 'transactions.other', { count }); }
